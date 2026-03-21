import {
	createRoom as createRoomService,
	joinRoom as joinRoomService,
	getRoom as getRoomService,
	updatePlayerSocket,
} from "./room.service.js";

export const createRoom = async (hostId) => createRoomService(hostId);

export const joinRoom = async (roomCode, player) => joinRoomService(roomCode, player);

export const getRoom = async (roomCode) => getRoomService(roomCode);

export const rejoinRoom = async (roomCode, playerId, socketId, name) => {
	const room = await getRoomService(roomCode);
	if (!room) return null;
	if (playerId === room.hostId) return room;

	const player = room.players.find((p) => p.id === playerId);

	if (player) {
		if (name) player.name = name;
		player.socketId = socketId;
		await joinRoomService(roomCode, player);
	} else {
		await joinRoomService(roomCode, {
			id: playerId,
			name: name || "Player",
			socketId,
		});
	}

	return updatePlayerSocket(roomCode, playerId, socketId);
};
