const MAX_CONTEXT_CHARS = 12000;

const getEnv = (key, fallback = "") => {
	const raw = process.env[key];
	if (raw === undefined || raw === null) return fallback;
	const cleaned = String(raw).trim().replace(/^['"]|['"]$/g, "");
	return cleaned || fallback;
};

const SYSTEM_PROMPT = `You generate multiple choice quiz questions.
Rules:
- Return strict JSON only.
- Top-level shape: {"questions":[...]}.
- Each question must have:
  - "text": question string
  - "options": array of exactly 4 short answer choices
  - "correctAnswer": must match one option exactly
- Keep questions clear and unambiguous.
- No explanations.`;

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const getFileType = (file) => {
	const mimetype = (file?.mimetype || "").toLowerCase();
	const name = (file?.originalname || "").toLowerCase();
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

	if (mimetype.includes("pdf") || ext === ".pdf") return "pdf";
	if (
		mimetype.includes(
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		) ||
		ext === ".docx"
	)
		return "docx";
	if (
		mimetype.startsWith("text/") ||
		[".txt", ".md", ".markdown", ".csv", ".json", ".xml"].includes(ext)
	)
		return "text";
	if (mimetype.includes("html") || [".html", ".htm"].includes(ext)) return "html";

	return "unsupported";
};

const cleanExtractedText = (value) =>
	trim(
		String(value || "")
			.replace(/\r\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.replace(/[ \t]{2,}/g, " "),
	);

const parseJsonFromModel = (raw) => {
	if (!raw || typeof raw !== "string") return null;

	try {
		return JSON.parse(raw);
	} catch {
		// Continue to fallback parsing.
	}

	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	if (fenced?.[1]) {
		try {
			return JSON.parse(fenced[1]);
		} catch {
			// Continue to broad match.
		}
	}

	const objectMatch = raw.match(/\{[\s\S]*\}/);
	if (objectMatch?.[0]) {
		try {
			return JSON.parse(objectMatch[0]);
		} catch {
			return null;
		}
	}

	return null;
};

const normalizeQuestions = (payload, limit) => {
	const source = Array.isArray(payload) ? payload : payload?.questions;
	if (!Array.isArray(source)) return [];

	const questions = [];
	for (const raw of source) {
		if (questions.length >= limit) break;

		const text = trim(raw?.text || raw?.question);
		const options = Array.isArray(raw?.options)
			? raw.options.map((o) => trim(o)).filter(Boolean).slice(0, 4)
			: [];

		let correctAnswer = trim(raw?.correctAnswer || raw?.answer);
		const correctIndex =
			typeof raw?.correctIndex === "number" ? raw.correctIndex : null;

		if (!correctAnswer && correctIndex !== null && options[correctIndex]) {
			correctAnswer = options[correctIndex];
		}

		if (!text || options.length !== 4) continue;
		if (!correctAnswer || !options.includes(correctAnswer)) continue;

		questions.push({
			text,
			options,
			correctAnswer,
		});
	}

	return questions;
};

const getProviderConfig = () => {
	const provider = getEnv("AI_PROVIDER", "openai").toLowerCase();

	if (provider === "groq") {
		return {
			provider,
			baseUrl: getEnv("AI_BASE_URL", "https://api.groq.com/openai/v1"),
			model: getEnv("AI_MODEL", "llama-3.3-70b-versatile"),
			apiKey: getEnv("AI_API_KEY"),
		};
	}

	if (provider === "ollama") {
		return {
			provider,
			baseUrl: getEnv("AI_BASE_URL", "http://localhost:11434"),
			model: getEnv("AI_MODEL", "llama3.1"),
			apiKey: null,
		};
	}

	return {
		provider: "openai",
		baseUrl: getEnv("AI_BASE_URL", "https://api.openai.com/v1"),
		model: getEnv("AI_MODEL", "gpt-4.1-mini"),
		apiKey: getEnv("AI_API_KEY"),
	};
};

const callOpenAICompatible = async ({ baseUrl, apiKey, model, userPrompt }) => {
	if (!apiKey) {
		throw new Error("AI_API_KEY is missing for the selected provider");
	}
	if (/^your[_-]/i.test(apiKey)) {
		throw new Error(
			"AI_API_KEY looks like a placeholder value. Set your real provider key in backend/.env",
		);
	}

	const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			temperature: 0.6,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: userPrompt },
			],
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`LLM request failed (${response.status}): ${text}`);
	}

	const data = await response.json();
	return data?.choices?.[0]?.message?.content || "";
};

const callOllama = async ({ baseUrl, model, userPrompt }) => {
	const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			stream: false,
			format: "json",
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: userPrompt },
			],
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`LLM request failed (${response.status}): ${text}`);
	}

	const data = await response.json();
	return data?.message?.content || "";
};

export const generateMcqQuestions = async ({ prompt, questionCount, contextText }) => {
	const cleanPrompt = trim(prompt);
	const count = Math.min(Math.max(Number(questionCount) || 0, 1), 30);
	const context = trim(contextText).slice(0, MAX_CONTEXT_CHARS);

	if (!cleanPrompt) throw new Error("Prompt is required");

	const providerConfig = getProviderConfig();
	const userPrompt = `Create ${count} MCQ questions.
Prompt/topic: ${cleanPrompt}
${context ? `Context to use:\n${context}\n` : ""}
Remember: return JSON only in the required shape.`;

	const raw =
		providerConfig.provider === "ollama"
			? await callOllama({
					baseUrl: providerConfig.baseUrl,
					model: providerConfig.model,
					userPrompt,
				})
			: await callOpenAICompatible({
					baseUrl: providerConfig.baseUrl,
					apiKey: providerConfig.apiKey,
					model: providerConfig.model,
					userPrompt,
				});

	const parsed = parseJsonFromModel(raw);
	const questions = normalizeQuestions(parsed, count);

	if (!questions.length) {
		throw new Error("Model response could not be parsed into valid MCQ questions");
	}

	return {
		questions,
		provider: providerConfig.provider,
		model: providerConfig.model,
		requestedCount: count,
	};
};

export const extractTextFromUpload = async (file) => {
	if (!file?.buffer?.length) {
		throw new Error("No file uploaded");
	}

	const fileType = getFileType(file);

	if (fileType === "html") {
		throw new Error("HTML files are not supported. Please upload PDF, DOCX, or text files.");
	}

	if (fileType === "unsupported") {
		throw new Error("Unsupported file type. Use PDF, DOCX, TXT, or MD.");
	}

	let extracted = "";

	if (fileType === "pdf") {
		const pdfModule = await import("pdf-parse");

		// pdf-parse v1 default export is a function; v2 uses PDFParse class.
		if (typeof pdfModule?.default === "function") {
			const result = await pdfModule.default(file.buffer);
			extracted = result?.text || "";
		} else if (typeof pdfModule?.PDFParse === "function") {
			const parser = new pdfModule.PDFParse({ data: file.buffer });
			try {
				const result = await parser.getText();
				extracted = result?.text || "";
			} finally {
				if (typeof parser.destroy === "function") {
					await parser.destroy();
				}
			}
		} else {
			throw new Error("Unsupported pdf-parse module format in this environment");
		}
	}

	if (fileType === "docx") {
		const mammoth = (await import("mammoth")).default;
		const result = await mammoth.extractRawText({ buffer: file.buffer });
		extracted = result?.value || "";
	}

	if (fileType === "text") {
		extracted = file.buffer.toString("utf8");
	}

	const cleaned = cleanExtractedText(extracted);
	if (!cleaned) {
		throw new Error("Could not extract readable text from this file");
	}

	return {
		text: cleaned.slice(0, MAX_CONTEXT_CHARS),
		fileType,
		chars: cleaned.length,
		truncated: cleaned.length > MAX_CONTEXT_CHARS,
	};
};
