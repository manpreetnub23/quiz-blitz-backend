# Quiz Backend (Node.js + Socket.IO + Redis)

Realtime multiplayer quiz backend where users join with just:
- `name`
- `roomCode`

No login/auth provider is required.

## Features

- Room lifecycle: create, join, rejoin, fetch state
- Host controls: add questions, start quiz
- Timed quiz flow:
  - prepare phase
  - question phase
  - answer validation
  - scoring + leaderboard

## Tech Stack

- Node.js (ESM, `"type": "module"`)
- Express
- Socket.IO
- ioredis

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
```

## Environment Variables

Create/update `backend/.env`:

```env
PORT=8000
WAITTIME=5000
ATTEMPTTIME=10000
REDIS_URL=redis://<user>:<password>@<host>:<port>
```

Notes:
- `WAITTIME` and `ATTEMPTTIME` are milliseconds.

## Installation

```bash
cd backend
npm install
```

## Run

Development:

```bash
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

## Socket Events

### Client -> Server

- `create_room` (no payload)
- `join_room` `{ roomCode, name, playerId? }`
- `rejoin_room` `{ roomCode, playerId, name? }`
- `get_room_state` `{ roomCode }`
- `add_question` `{ roomCode, question, playerId }` (host only)
- `start_quiz` `{ roomCode, playerId }` (host only)
- `submit_answer` `{ roomCode, answer, playerId }`

### Server -> Client

- `player_identity` `{ playerId }`
- `room_created` `room`
- `player_joined` `room`
- `room_state` `{ status, currentQuestionIndex, questionStartTime, questionDuration, roomCode, players }`
- `question_added` `questions[]`
- `question_prepare` `{ questionIndex, duration, startTime }`
- `question_start` `{ questionIndex, question, duration, startTime }`
- `question_result` `{ questionIndex, correctAnswer, results }`
- `quiz_finished` `leaderboard[]`
- `answer_rejected` `{ reason }`
- `error` `{ message }` (or string in a few legacy emits)

## Question Shape

Typical `question` object for `add_question`:

```json
{
  "text": "What is 2 + 2?",
  "options": ["1", "2", "3", "4"],
  "correctAnswer": "4"
}
```

## Scoring

For correct answers:
- base score is `1000`
- decreases linearly by response time
- minimum score for correct answer is `100`

## Common Issues

- `Room not found`
  - invalid room code or room expired
- `Only host can add questions` / `Only host can start quiz`
  - ensure host is using the same `playerId` returned by `player_identity`
- Redis connection errors (`EACCES`, `ECONNREFUSED`, etc.)
  - verify `REDIS_URL`, network/firewall, and Redis availability
