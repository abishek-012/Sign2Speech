from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import shutil
import os
import uuid

from inference import predict_video

app = FastAPI(title="ISL Sign Recognition API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.get("/")
def root():
    return {
        "message": "ISL Sign Recognition API is running"
    }


@app.post("/predict")
async def predict(file: UploadFile = File(...)):

    extension = os.path.splitext(file.filename or "")[1].lower()

    allowed_extensions = {".mp4", ".mov", ".avi", ".webm"}

    if extension not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail="Unsupported video format"
        )

    filename = f"{uuid.uuid4()}{extension}"
    video_path = os.path.join(UPLOAD_DIR, filename)

    try:
        with open(video_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        result = predict_video(video_path)

        return result

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

    finally:
        if os.path.exists(video_path):
            os.remove(video_path)