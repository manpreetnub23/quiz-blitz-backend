import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import app from "./app.js";
import initSockets from "./sockets/index.js";

const server = http.createServer(app);

const io = new Server(server, {
	cors: { origin: "*" },
});

initSockets(io);

const PORT = process.env.PORT;

server.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
