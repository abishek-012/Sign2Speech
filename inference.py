import json
import cv2
import numpy as np
import tensorflow as tf
import mediapipe as mp


MODEL_PATH = "ISL_INCLUDE_NEW.keras"

LABEL_MAP_PATHS = {
    "english": "label_map_english.json",
    "tamil": "label_map_tamil.json",
    "hindi": "label_map_hindi.json"
}

MAX_LEN = 300
FEATURE_SIZE = 1662

mp_holistic = mp.solutions.holistic


model = tf.keras.models.load_model(
    MODEL_PATH,
    compile=False
)


def read_video_frames(video_path, max_duration_sec=7):
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        raise ValueError("Cannot open video")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    max_frames = int(fps * max_duration_sec)

    frames = []

    while len(frames) < max_frames:
        ret, frame = cap.read()

        if not ret:
            break

        frames.append(frame)

    cap.release()

    return frames


def extract_landmarks(frames):
    landmarks_seq = []

    with mp_holistic.Holistic(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=False,
        refine_face_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    ) as holistic:

        for frame in frames:

            image_rgb = cv2.cvtColor(
                frame,
                cv2.COLOR_BGR2RGB
            )

            results = holistic.process(image_rgb)

            pose = np.zeros((33, 3))
            left_hand = np.zeros((21, 3))
            right_hand = np.zeros((21, 3))
            face = np.zeros((468, 3))

            if results.pose_landmarks:
                pose = np.array([
                    [lm.x, lm.y, lm.z]
                    for lm in results.pose_landmarks.landmark
                ])

            if results.left_hand_landmarks:
                left_hand = np.array([
                    [lm.x, lm.y, lm.z]
                    for lm in results.left_hand_landmarks.landmark
                ])

            if results.right_hand_landmarks:
                right_hand = np.array([
                    [lm.x, lm.y, lm.z]
                    for lm in results.right_hand_landmarks.landmark
                ])

            if results.face_landmarks:
                face = np.array([
                    [lm.x, lm.y, lm.z]
                    for lm in results.face_landmarks.landmark
                ])

            frame_vec = np.concatenate([
                pose.flatten(),
                left_hand.flatten(),
                right_hand.flatten(),
                face.flatten()
            ])

            if len(frame_vec) < FEATURE_SIZE:
                frame_vec = np.pad(
                    frame_vec,
                    (0, FEATURE_SIZE - len(frame_vec))
                )
            else:
                frame_vec = frame_vec[:FEATURE_SIZE]

            landmarks_seq.append(frame_vec)

    return np.array(
        landmarks_seq,
        dtype=np.float32
    )


def predict_video(video_path, language="english"):

    if language not in LABEL_MAP_PATHS:
        raise ValueError(
            f"Unsupported language: {language}. "
            f"Supported languages: {list(LABEL_MAP_PATHS.keys())}"
        )

    frames = read_video_frames(video_path)

    if len(frames) == 0:
        raise ValueError("No frames extracted from video")

    landmarks = extract_landmarks(frames)

    if landmarks.shape[0] < MAX_LEN:
        landmarks = np.pad(
            landmarks,
            (
                (0, MAX_LEN - landmarks.shape[0]),
                (0, 0)
            ),
            mode="constant"
        )
    else:
        landmarks = landmarks[:MAX_LEN]

    input_tensor = np.expand_dims(
        landmarks,
        axis=0
    )

    prediction = model.predict(
        input_tensor,
        verbose=0
    )

    class_id = int(np.argmax(prediction))
    confidence = float(np.max(prediction))

    label_map_path = LABEL_MAP_PATHS[language]

    with open(
        label_map_path,
        "r",
        encoding="utf-8"
    ) as f:
        label_map = json.load(f)

    label = label_map.get(
        str(class_id),
        f"Class {class_id}"
    )

    return {
        "class_id": class_id,
        "label": label,
        "confidence": confidence,
        "language": language
    }
