import os
import shutil
import uuid

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware

from inference import predict_video


app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


UPLOAD_DIR = "uploads"

os.makedirs(
    UPLOAD_DIR,
    exist_ok=True
)


@app.get("/")
def root():
    return {
        "message": "ISL Sign2Speech Backend is running"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    language: str = Form("english")
):

    allowed_languages = {
        "english",
        "tamil",
        "hindi"
    }

    language = language.lower().strip()

    if language not in allowed_languages:
        return {
            "error": "Unsupported language",
            "supported_languages": list(allowed_languages)
        }

    file_extension = os.path.splitext(
        file.filename
    )[1]

    if not file_extension:
        file_extension = ".mp4"

    filename = (
        f"{uuid.uuid4()}"
        f"{file_extension}"
    )

    video_path = os.path.join(
        UPLOAD_DIR,
        filename
    )

    try:

        with open(
            video_path,
            "wb"
        ) as buffer:

            shutil.copyfileobj(
                file.file,
                buffer
            )

        result = predict_video(
            video_path,
            language
        )

        return result

    except Exception as e:

        return {
            "error": str(e)
        }

    finally:

        if os.path.exists(video_path):
            os.remove(video_path)