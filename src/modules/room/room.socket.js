import { createRoom, joinRoom, getRoom, rejoinRoom } from "./room.controller.js";

const registerRoomHandlers = (io, socket) => {
	socket.on("create_room", async () => {
		try {
			const room = await createRoom(socket.id);
			socket.join(room.roomCode);
			socket.emit("player_identity", { playerId: room.hostId });
			socket.emit("room_created", room);
		} catch (error) {
			socket.emit("error", { message: error.message });
		}
	});

	socket.on("join_room", async ({ roomCode, name, playerId }) => {
		try {
			const id = playerId || socket.id;
			const player = {
				id,
				name,
				socketId: socket.id,
			};

			const room = await joinRoom(roomCode, player);
			socket.join(roomCode);
			socket.emit("player_identity", { playerId: id });
			io.to(roomCode).emit("player_joined", room);
		} catch (error) {
			socket.emit("error", { message: error.message });
		}
	});

	socket.on("rejoin_room", async ({ roomCode, playerId, name }) => {
		try {
			if (!playerId) return;

			const room = await rejoinRoom(roomCode, playerId, socket.id, name);
			if (!room) return;

			socket.join(roomCode);

			socket.emit("room_state", {
				hostId: room.hostId,
				status: room.status,
				currentQuestionIndex: room.currentQuestionIndex,
				questionStartTime: room.questionStartTime,
				questionDuration: room.activeQuestionDuration,
				roomCode: room.roomCode,
				players: room.players,
				questions: room.questions,
			});
		} catch (error) {
			socket.emit("error", { message: error.message });
		}
	});

	socket.on("get_room_state", async ({ roomCode }) => {
		const room = await getRoom(roomCode);
		if (!room) return;

		socket.emit("room_state", {
			hostId: room.hostId,
			status: room.status,
			currentQuestionIndex: room.currentQuestionIndex,
			questionStartTime: room.questionStartTime,
			questionDuration: room.activeQuestionDuration,
			roomCode: room.roomCode,
			players: room.players,
			questions: room.questions,
		});
	});
};

export default registerRoomHandlers;
