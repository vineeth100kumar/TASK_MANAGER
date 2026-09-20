import json
from typing import List
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.register(websocket)

    def register(self, websocket: WebSocket):
        """
        Add an already-accepted socket to the broadcast pool.

        Kept separate from `connect` because the socket has to be accepted
        before it can be asked for credentials, and it must not receive a
        single broadcast until it has produced them.
        """
        if websocket not in self.active_connections:
            self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        payload = json.dumps(message)
        for connection in list(self.active_connections):
            try:
                await connection.send_text(payload)
            except Exception:
                self.disconnect(connection)

ws_manager = ConnectionManager()
