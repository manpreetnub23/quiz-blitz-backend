import redis from "../../config/redis.js";
import generateRoomCode from "../../utils/generateRoomCode.js";

const ROOM_PREFIX = "room:";

export const getRoomKey = (roomCode) => `${ROOM_PREFIX}${roomCode}`;

export const createRoom = async (hostId) => {
	const roomCode = generateRoomCode();
	const room = {
		roomCode,
		hostId,
		players: [],
		status: "waiting",
		questions: [],
		currentQuestionIndex: 0,
		questionStartTime: null,
		activeQuestionDuration: null,
	};

	await redis.set(getRoomKey(roomCode), JSON.stringify(room));
	return room;
};

export const saveRoom = async (room) => {
	await redis.set(getRoomKey(room.roomCode), JSON.stringify(room));
	return room;
};

export const getRoom = async (roomCode) => {
	const data = await redis.get(getRoomKey(roomCode));
	return data ? JSON.parse(data) : null;
};

export const joinRoom = async (roomCode, player) => {
	const room = await getRoom(roomCode);

	if (!room) {
		throw new Error("Room not found");
	}
	if (player.id === room.hostId) {
		return room;
	}

	const existingIndex = room.players.findIndex((p) => p.id === player.id);

	if (existingIndex >= 0) {
		room.players[existingIndex] = {
			...room.players[existingIndex],
			...player,
		};
	} else {
		room.players.push(player);
	}

	await saveRoom(room);
	return room;
};

export const updatePlayerSocket = async (roomCode, playerId, socketId) => {
	const room = await getRoom(roomCode);
	if (!room) return null;

	const player = room.players.find((p) => p.id === playerId);
	if (!player) return room;

	player.socketId = socketId;
	await saveRoom(room);
	return room;
};

export const getPlayerIdFromSocket = (room, socketId) => {
	const player = room.players.find((p) => p.socketId === socketId || p.id === socketId);
	return player?.id || socketId;
};
