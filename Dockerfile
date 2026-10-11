FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir fastapi uvicorn httpx
COPY prompts.json ./
COPY server ./server
COPY web ./web
ENV PORT=8000
EXPOSE 8000
# Cloud Run, App Runner and most container hosts pass the port to listen on as $PORT.
CMD ["sh", "-c", "exec uvicorn server.main:app --host 0.0.0.0 --port ${PORT}"]
