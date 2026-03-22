# Quiz Backend (Node.js + Socket.IO + Redis + AI)

Realtime multiplayer quiz backend with room/game sockets and AI-assisted MCQ generation.

## Features

- Room lifecycle: create, join, rejoin, fetch room state
- Host controls:
  - add questions
  - delete questions (before quiz starts)
  - start quiz
- Timed game flow:
  - prepare phase
  - question phase
  - answer validation (first valid answer per player per question)
  - scoring + leaderboard
- AI module:
  - generate MCQs from prompt/context
  - extract text from uploaded files (`PDF`, `DOCX`, `TXT`, `MD`)

## Tech Stack

- Node.js (ESM)
- Express
- Socket.IO
- Redis (`ioredis`)
- Multer (file upload)
- `pdf-parse` and `mammoth` (document text extraction)

## Project Structure

```txt
src/
  app.js
  server.js
  config/
    redis.js
  sockets/
    index.js
  modules/
    room/
      room.socket.js
      room.controller.js
      room.service.js
    game/
      game.socket.js
      game.service.js
    ai/
      ai.routes.js
      ai.service.js
```

## Environment Variables

Create/update `backend/.env`:

```env
PORT=8000
WAITTIME=5000
ATTEMPTTIME=10000
REDIS_URL=redis://<user>:<password>@<host>:<port>

# AI provider config
AI_PROVIDER=groq
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile
AI_API_KEY=<your-provider-api-key>
```

Supported providers:

- `groq` (OpenAI-compatible endpoint)
- `openai`
- `ollama` (local, no API key required)

Notes:

- `WAITTIME` and `ATTEMPTTIME` are in milliseconds.
- Keep `AI_API_KEY` secret and never commit it.

## Install and Run

```bash
cd backend
npm install
npm run dev
```

Direct run:

```bash
node src/server.js
```

Health check:

```http
GET /
```

Response:

```txt
Api running!
```

## REST API (AI)

Base: `/api/ai`

### `POST /generate-mcq`

Body:

```json
{
  "prompt": "Create interview prep questions from this resume",
  "questionCount": 5,
  "contextText": "optional extracted or pasted text"
}
```

Response:

```json
{
  "questions": [
    {
      "text": "Question text",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "A"
    }
  ],
  "meta": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "requestedCount": 5,
    "generatedCount": 5
  }
}
```

### `POST /extract-text`

- Multipart form-data with field name: `file`
- Max upload size: `10MB`
- Supported formats: `PDF`, `DOCX`, `TXT`, `MD`, `CSV`, `JSON`, `XML`
- HTML uploads are intentionally rejected

Response includes extracted text and metadata (`fileType`, `chars`, `truncated`).

## Socket Events

### Client -> Server

- `create_room` (no payload)
- `join_room` `{ roomCode, name, playerId? }`
- `rejoin_room` `{ roomCode, playerId, name? }`
- `get_room_state` `{ roomCode }`
- `add_question` `{ roomCode, question, playerId }` (host only)
- `delete_question` `{ roomCode, questionId, playerId }` (host only, waiting phase only)
- `start_quiz` `{ roomCode, playerId }` (host only)
- `submit_answer` `{ roomCode, answer, playerId }`

### Server -> Client

- `player_identity` `{ playerId }`
- `room_created` `room`
- `player_joined` `room`
- `room_state` `{ status, currentQuestionIndex, questionStartTime, questionDuration, roomCode, players, ... }`
- `question_added` `room`
- `question_prepare` `{ questionIndex, duration, startTime }`
- `question_start` `{ questionIndex, question, duration, startTime }`
- `question_result` `{ questionIndex, correctAnswer, results }`
- `quiz_finished` `leaderboard[]`
- `answer_rejected` `{ reason }`
- `error` `{ message }` or string

## Question Shape

Used by `add_question` and AI-generated insert flow:

```json
{
  "text": "What is 2 + 2?",
  "options": ["1", "2", "3", "4"],
  "correctAnswer": "4"
}
```

## Scoring

For correct answers:

- base score: `1000`
- decreases with response time
- minimum correct score: `100`

## Common Issues

- `Room not found`
  - invalid/expired room code
- `Only host can add questions` / `Only host can delete questions` / `Only host can start quiz`
  - host must use the same identity (`playerId`) used to create the room
- `LLM request failed (401)` or `Invalid API key`
  - check `AI_PROVIDER`, `AI_BASE_URL`, and `AI_API_KEY` alignment
  - restart backend after editing `.env`
- Redis connection errors (`EACCES`, `ECONNREFUSED`, etc.)
  - verify `REDIS_URL`, network/firewall, and Redis availability
