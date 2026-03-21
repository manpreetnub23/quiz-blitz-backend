import registerRoomHandlers from "../modules/room/room.socket.js";
import registerGameHandlers from "../modules/game/game.socket.js";

const initSockets = (io) => {
	io.on("connection", (socket) => {
		console.log("A user connected: " + socket.id);

		registerRoomHandlers(io, socket);
		registerGameHandlers(io, socket);

		// on disconnect
		socket.on("disconnect", () => {
			console.log("A user disconnected: " + socket.id);
		});
	});
};

export default initSockets;
