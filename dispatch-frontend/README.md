# Discharge Summary Agent Frontend

React/Vite frontend for the discharge summary agent.

## Run Locally

```bash
npm install
npm run dev
```

The app runs on `http://localhost:3000` and calls the FastAPI backend at `http://localhost:8001` by default.

To point at a different backend, create `.env`:

```bash
VITE_API_BASE=http://localhost:8001
```
