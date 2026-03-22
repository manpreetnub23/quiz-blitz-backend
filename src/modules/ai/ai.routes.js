import { Router } from "express";
import multer from "multer";
import { extractTextFromUpload, generateMcqQuestions } from "./ai.service.js";

const router = Router();
const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 10 * 1024 * 1024,
	},
});

router.post("/generate-mcq", async (req, res) => {
	try {
		const { prompt, questionCount, contextText } = req.body || {};
		const result = await generateMcqQuestions({
			prompt,
			questionCount,
			contextText,
		});

		res.json({
			questions: result.questions,
			meta: {
				provider: result.provider,
				model: result.model,
				requestedCount: result.requestedCount,
				generatedCount: result.questions.length,
			},
		});
	} catch (error) {
		res.status(400).json({
			message: error?.message || "Failed to generate questions",
		});
	}
});

router.post("/extract-text", upload.single("file"), async (req, res) => {
	try {
		const result = await extractTextFromUpload(req.file);
		res.json({
			text: result.text,
			meta: {
				fileType: result.fileType,
				chars: result.chars,
				truncated: result.truncated,
			},
		});
	} catch (error) {
		res.status(400).json({
			message: error?.message || "Failed to extract text from file",
		});
	}
});

export default router;
