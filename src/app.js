import express from "express";
import cors from "cors";
import aiRouter from "./modules/ai/ai.routes.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/ai", aiRouter);

app.get("/", (req, res) => {
	res.send("Api running!");
});

export default app;
