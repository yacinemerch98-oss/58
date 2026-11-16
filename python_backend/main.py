"""
Recap Studio AI — Python FastAPI + OpenCV Video Vision & Processing Service
Optional dedicated GPU/CPU microservice for OpenCV CSRT object tracking and
MediaPipe Selfie Segmentation when deployed alongside the Node.js orchestrator.
"""

import os
import tempfile
from typing import List
import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

app = FastAPI(title="Recap Studio AI Vision Worker", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok", "opencv": cv2.__version__}


@app.post("/vision/track-object")
async def track_object(
    video: UploadFile = File(...),
    x: float = Form(...),
    y: float = Form(...),
    width: float = Form(...),
    height: float = Form(...),
    start_time: float = Form(0.0),
    end_time: float = Form(10.0),
):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
        tmp.write(await video.read())
        tmp_path = tmp.name

    try:
        cap = cv2.VideoCapture(tmp_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        start_frame = int(start_time * fps)
        end_frame = int(end_time * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        ok, frame = cap.read()
        if not ok:
            return JSONResponse({"error": "Could not read start frame"}, status_code=400)

        bbox = (
            int(x * frame_w),
            int(y * frame_h),
            max(16, int(width * frame_w)),
            max(16, int(height * frame_h)),
        )
        tracker = cv2.TrackerCSRT_create()
        tracker.init(frame, bbox)

        keyframes: List[dict] = [
            {"time": round(start_time, 2), "x": x, "y": y, "width": width, "height": height}
        ]
        sample_step = max(1, int(fps // 5))
        frame_idx = start_frame

        while frame_idx < end_frame:
            ok, frame = cap.read()
            if not ok:
                break
            frame_idx += 1
            success, box = tracker.update(frame)
            if success and (frame_idx - start_frame) % sample_step == 0:
                bx, by, bw, bh = box
                keyframes.append(
                    {
                        "time": round(frame_idx / fps, 2),
                        "x": max(0.0, min(1.0, bx / frame_w)),
                        "y": max(0.0, min(1.0, by / frame_h)),
                        "width": max(0.02, min(1.0, bw / frame_w)),
                        "height": max(0.02, min(1.0, bh / frame_h)),
                    }
                )

        cap.release()
        return {"keyframes": keyframes}
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
