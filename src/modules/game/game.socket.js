import { startQuiz, submitAnswer } from "./game.service.js";
import { getRoom, saveRoom } from "../room/room.service.js";

const registerGameHandlers = (io, socket) => {
	const canManageQuestions = (room, playerId) => {
		const hostPlayer = room.players.find((p) => p.id === room.hostId);
		return (
			room.hostId === socket.id ||
			playerId === room.hostId ||
			hostPlayer?.socketId === socket.id
		);
	};

	socket.on("add_question", async ({ roomCode, question, playerId }, callback) => {
		try {
			const room = await getRoom(roomCode);

			if (!room) {
				socket.emit("error", "Room not found");
				if (typeof callback === "function") callback({ ok: false, message: "Room not found" });
				return;
			}
			const isHost = canManageQuestions(room, playerId);

			if (!isHost) {
				socket.emit("error", "Only host can add questions");
				if (typeof callback === "function") callback({ ok: false, message: "Only host can add questions" });
				return;
			}
			if (room.status !== "waiting") {
				socket.emit("error", "Quiz already started");
				if (typeof callback === "function") callback({ ok: false, message: "Quiz already started" });
				return;
			}

			room.questions.push({
				...question,
				id: Date.now(),
			});

			await saveRoom(room);
			io.to(roomCode).emit("question_added", room);
			if (typeof callback === "function") {
				callback({ ok: true, questionsCount: room.questions.length });
			}
		} catch (error) {
			socket.emit("error", error.message || "Failed to add question");
			if (typeof callback === "function") callback({ ok: false, message: error.message || "Failed to add question" });
		}
	});

	socket.on("delete_question", async ({ roomCode, questionId, playerId }, callback) => {
		try {
			const room = await getRoom(roomCode);
			if (!room) {
				if (typeof callback === "function") callback({ ok: false, message: "Room not found" });
				return;
			}

			const isHost = canManageQuestions(room, playerId);
			if (!isHost) {
				if (typeof callback === "function") callback({ ok: false, message: "Only host can delete questions" });
				return;
			}
			if (room.status !== "waiting") {
				if (typeof callback === "function") callback({ ok: false, message: "Quiz already started" });
				return;
			}

			const before = room.questions.length;
			room.questions = room.questions.filter((q) => String(q.id) !== String(questionId));
			if (room.questions.length === before) {
				if (typeof callback === "function") callback({ ok: false, message: "Question not found" });
				return;
			}

			await saveRoom(room);
			io.to(roomCode).emit("question_added", room);
			if (typeof callback === "function") callback({ ok: true, questionsCount: room.questions.length });
		} catch (error) {
			if (typeof callback === "function") callback({ ok: false, message: error.message || "Failed to delete question" });
		}
	});

	socket.on("start_quiz", async ({ roomCode, playerId }) => {
		try {
			const room = await getRoom(roomCode);

			if (!room) return socket.emit("error", "Room not found");
			const isHost = canManageQuestions(room, playerId);

			if (!isHost) {
				return socket.emit("error", "Only host can start quiz");
			}
			if (room.questions.length === 0) {
				return socket.emit("error", "Add at least 1 question");
			}

			await startQuiz(io, roomCode);
		} catch (error) {
			socket.emit("error", error.message || "Failed to start quiz");
		}
	});

	socket.on("submit_answer", async ({ roomCode, answer, playerId }) => {
		const result = await submitAnswer({
			roomCode,
			socketId: socket.id,
			playerId,
			answer,
		});

		if (!result.accepted && result.reason) {
			socket.emit("answer_rejected", {
				reason: result.reason,
			});
		}
	});
};

export default registerGameHandlers;
