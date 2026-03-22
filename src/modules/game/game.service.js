import redis from "../../config/redis.js";
import { getPlayerIdFromSocket, getRoom, saveRoom } from "../room/room.service.js";

const DEFAULT_PREPARE_TIME = Number(process.env.WAITTIME || 5000);
const DEFAULT_QUESTION_TIME = Number(process.env.ATTEMPTTIME || 10000);
const timers = new Map();

const answerKey = (roomCode, questionIndex) => `answers:${roomCode}:${questionIndex}`;
const scoreKey = (roomCode) => `score:${roomCode}`;

const getQuestionPayload = (question) => ({
	id: question.id,
	text: question.text ?? question.question ?? "",
	options: question.options,
});

const setRoomTimer = (roomCode, timeoutId) => {
	const currentTimer = timers.get(roomCode);
	if (currentTimer) clearTimeout(currentTimer);
	timers.set(roomCode, timeoutId);
};

const clearRoomTimer = (roomCode) => {
	const timeoutId = timers.get(roomCode);
	if (timeoutId) clearTimeout(timeoutId);
	timers.delete(roomCode);
};

export const calculateScore = (timeTaken, maxTime) => {
	const base = 1000;
	const ratio = timeTaken / maxTime;
	return Math.max(Math.floor(base * (1 - ratio)), 100);
};

export const startQuiz = async (io, roomCode) => {
	const room = await getRoom(roomCode);
	if (!room) throw new Error("Room not found");

	room.status = "in_progress";
	room.currentQuestionIndex = 0;
	room.questionStartTime = null;
	room.activeQuestionDuration = DEFAULT_QUESTION_TIME;

	await saveRoom(room);
	await redis.del(scoreKey(roomCode));

	for (let i = 0; i < room.questions.length; i += 1) {
		await redis.del(answerKey(roomCode, i));
	}

	await runPreparePhase(io, roomCode);
};

const runPreparePhase = async (io, roomCode) => {
	const room = await getRoom(roomCode);
	if (!room || room.status !== "in_progress") return;

	if (room.currentQuestionIndex >= room.questions.length) {
		await finishQuiz(io, roomCode);
		return;
	}

	const now = Date.now();

	io.to(roomCode).emit("question_prepare", {
		questionIndex: room.currentQuestionIndex,
		duration: DEFAULT_PREPARE_TIME,
		startTime: now,
	});

	setRoomTimer(
		roomCode,
		setTimeout(() => {
			runQuestionPhase(io, roomCode).catch((err) => console.error("question phase error", err));
		}, DEFAULT_PREPARE_TIME),
	);
};

const runQuestionPhase = async (io, roomCode) => {
	const room = await getRoom(roomCode);
	if (!room || room.status !== "in_progress") return;

	const question = room.questions[room.currentQuestionIndex];
	if (!question) {
		await finishQuiz(io, roomCode);
		return;
	}

	const now = Date.now();
	room.questionStartTime = now;
	room.activeQuestionDuration = DEFAULT_QUESTION_TIME;
	await saveRoom(room);

	io.to(roomCode).emit("question_start", {
		questionIndex: room.currentQuestionIndex,
		question: getQuestionPayload(question),
		duration: DEFAULT_QUESTION_TIME,
		startTime: now,
	});

	setRoomTimer(
		roomCode,
		setTimeout(() => {
			finalizeQuestion(io, roomCode).catch((err) => console.error("finalize question error", err));
		}, DEFAULT_QUESTION_TIME),
	);
};

const finalizeQuestion = async (io, roomCode) => {
	const room = await getRoom(roomCode);
	if (!room || room.status !== "in_progress") return;

	const questionIndex = room.currentQuestionIndex;
	const question = room.questions[questionIndex];
	if (!question) {
		await finishQuiz(io, roomCode);
		return;
	}

	const results = await evaluateAnswers(roomCode, questionIndex, question, room.questionStartTime, room.activeQuestionDuration);

	io.to(roomCode).emit("question_result", {
		questionIndex,
		correctAnswer: question.correctAnswer,
		results,
	});

	room.currentQuestionIndex += 1;
	room.questionStartTime = null;
	await saveRoom(room);

	setRoomTimer(
		roomCode,
		setTimeout(() => {
			runPreparePhase(io, roomCode).catch((err) => console.error("prepare phase error", err));
		}, 3000),
	);
};

const evaluateAnswers = async (roomCode, questionIndex, question, questionStartTime, maxTime) => {
	const rawAnswers = await redis.hgetall(answerKey(roomCode, questionIndex));
	const results = [];

	for (const [playerId, raw] of Object.entries(rawAnswers)) {
		try {
			const parsed = JSON.parse(raw);
			const isCorrect = parsed.answer === question.correctAnswer;
			let score = 0;

			if (isCorrect && questionStartTime) {
				const timeTaken = Math.max(parsed.time - questionStartTime, 0);
				score = calculateScore(timeTaken, maxTime || DEFAULT_QUESTION_TIME);
				await redis.zincrby(scoreKey(roomCode), score, playerId);
			}

			results.push({
				playerId,
				correct: isCorrect,
				score,
				answer: parsed.answer,
				time: parsed.time,
			});
		} catch {
			// ignore malformed answer payloads
		}
	}

	return results;
};

export const submitAnswer = async ({ roomCode, socketId, playerId, answer }) => {
	const room = await getRoom(roomCode);

	if (!room || room.status !== "in_progress") {
		return { accepted: false, reason: "Room not in progress" };
	}

	const questionIndex = room.currentQuestionIndex;
	const question = room.questions[questionIndex];

	if (!question) {
		return { accepted: false, reason: "Question not found" };
	}

	const startTime = room.questionStartTime;
	const duration = room.activeQuestionDuration || DEFAULT_QUESTION_TIME;

	if (!startTime) {
		return { accepted: false, reason: "Question has not started" };
	}

	if (Date.now() > startTime + duration) {
		return { accepted: false, reason: "Late answer" };
	}

	if (!Array.isArray(question.options) || !question.options.includes(answer)) {
		return { accepted: false, reason: "Invalid option" };
	}

	const participantId = playerId || getPlayerIdFromSocket(room, socketId);
	if (participantId === room.hostId) {
		return { accepted: false, reason: "Host cannot submit answers" };
	}
	const key = answerKey(roomCode, questionIndex);
	const payload = JSON.stringify({
		answer,
		time: Date.now(),
		socketId,
	});

	const inserted = await redis.hsetnx(key, participantId, payload);

	if (inserted === 0) {
		return { accepted: false, reason: "Already answered" };
	}

	return { accepted: true };
};

export const getLeaderboard = async (roomCode) => {
	const raw = await redis.zrevrange(scoreKey(roomCode), 0, -1, "WITHSCORES");
	const leaderboard = [];

	for (let i = 0; i < raw.length; i += 2) {
		leaderboard.push({
			playerId: raw[i],
			score: Number(raw[i + 1]),
		});
	}

	return leaderboard;
};

export const finishQuiz = async (io, roomCode) => {
	const room = await getRoom(roomCode);
	if (!room) return;

	room.status = "finished";
	room.questionStartTime = null;
	await saveRoom(room);

	clearRoomTimer(roomCode);
	const leaderboard = await getLeaderboard(roomCode);
	const scoreByPlayer = new Map(leaderboard.map((entry) => [entry.playerId, entry.score]));
	const fullLeaderboard = (room.players || []).map((player) => ({
		playerId: player.id,
		score: scoreByPlayer.get(player.id) ?? 0,
	}));
	fullLeaderboard.sort((a, b) => b.score - a.score);
	io.to(roomCode).emit("quiz_finished", fullLeaderboard);
};

export const stopQuizLoop = (roomCode) => {
	clearRoomTimer(roomCode);
};
