import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  Circle,
  Clock3,
  ImagePlus,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { loadSubmission, submitProof } from "../api";
import { iconFor } from "../quest-icons";
import type { ProofSession, QuestAssignment, Submission } from "../types";

interface CaptureSheetProps {
  assignment: QuestAssignment;
  session: ProofSession;
  onClose: () => void;
  onVerified: (submission: Submission) => void;
}

type CaptureStage = "camera" | "review" | "submitting" | "verifying" | "result";

function secondsUntil(isoDate: string) {
  return Math.max(0, Math.ceil((new Date(isoDate).getTime() - Date.now()) / 1000));
}

function formatTimer(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const PROOF_MAXIMUM_DIMENSION = 1024;
const PROOF_JPEG_QUALITY = 0.78;

function normalizedCanvasSize(width: number, height: number) {
  const scale = Math.min(1, PROOF_MAXIMUM_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function normalizeProofImage(dataUrl: string) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("That image could not be prepared."));
    image.src = dataUrl;
  });
  const size = normalizedCanvasSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image preparation is unavailable in this browser.");
  context.drawImage(image, 0, 0, size.width, size.height);
  return canvas.toDataURL("image/jpeg", PROOF_JPEG_QUALITY);
}

function demoCapture(assignment: QuestAssignment, challenge: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable in this browser.");
  const gradient = context.createLinearGradient(0, 0, 1200, 900);
  gradient.addColorStop(0, "#171712");
  gradient.addColorStop(0.56, "#7b5cff");
  gradient.addColorStop(1, "#d8ff63");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1200, 900);
  context.globalAlpha = 0.18;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(1010, 150, 270, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(130, 800, 210, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
  context.fillStyle = "#f8f5ed";
  context.font = "700 34px Arial";
  context.fillText("IRLQUEST · DEMO CAMERA", 70, 100);
  context.font = "900 104px Arial";
  context.fillText(assignment.quest.title.toUpperCase(), 70, 390);
  context.font = "500 36px Arial";
  context.fillText(challenge.slice(0, 56), 75, 475);
  context.font = "500 28px Arial";
  context.fillText(new Date().toLocaleString(), 75, 810);
  return canvas.toDataURL("image/jpeg", 0.9);
}

export default function CaptureSheet({
  assignment,
  session,
  onClose,
  onVerified,
}: CaptureSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const notifiedRef = useRef(false);
  const mountedRef = useRef(true);
  const [stage, setStage] = useState<CaptureStage>("camera");
  const [photo, setPhoto] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(session.expiresAt));
  const QuestIcon = iconFor(assignment.quest.icon);
  const galleryFallbackEnabled = import.meta.env.DEV || import.meta.env.VITE_ALLOW_GALLERY_FALLBACK === "true";

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Live camera access is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError("Camera permission was denied or no camera was found.");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    const timer = window.setInterval(() => setSecondsLeft(secondsUntil(session.expiresAt)), 1000);
    return () => window.clearInterval(timer);
  }, [session.expiresAt]);

  useEffect(() => {
    if (submission?.status === "accepted" && !notifiedRef.current) {
      notifiedRef.current = true;
      onVerified(submission);
    }
  }, [onVerified, submission]);

  function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("The camera is still warming up. Try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    const size = normalizedCanvasSize(video.videoWidth, video.videoHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", PROOF_JPEG_QUALITY));
    stopCamera();
    setStage("review");
  }

  function useDemoCapture() {
    setPhoto(demoCapture(assignment, session.challenge));
    stopCamera();
    setStage("review");
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== "string") return;
      try {
        setPhoto(await normalizeProofImage(reader.result));
        stopCamera();
        setStage("review");
      } catch (caught) {
        setCameraError(caught instanceof Error ? caught.message : "That image could not be prepared.");
      }
    };
    reader.onerror = () => setCameraError("That image could not be read.");
    reader.readAsDataURL(file);
  }

  async function pollForVerdict(id: string) {
    for (let attempt = 0; attempt < 125; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      if (!mountedRef.current) return;
      const next = await loadSubmission(id);
      setSubmission(next);
      if (next.status !== "pending") {
        setStage("result");
        return;
      }
    }
    throw new Error("Verification is taking longer than expected. You can safely return to your quests.");
  }

  async function handleSubmit() {
    if (!photo) return;
    if (secondsLeft <= 0) {
      setError("This live challenge expired. Close it and start a fresh attempt.");
      return;
    }
    setError(null);
    setStage("submitting");
    try {
      const created = await submitProof(session.id, photo);
      setSubmission(created);
      setStage("verifying");
      await pollForVerdict(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The proof could not be submitted.");
      setStage(submission ? "verifying" : "review");
    }
  }

  function retake() {
    setPhoto(null);
    setError(null);
    setStage("camera");
    void startCamera();
  }

  const closeAllowed = stage !== "submitting";
  const verdict = submission?.verdict;

  return (
    <div className="capture-backdrop" role="presentation">
      <section className="capture-sheet" role="dialog" aria-modal="true" aria-labelledby="capture-title">
        <header className="capture-header">
          <button
            className="icon-button"
            type="button"
            onClick={stage === "review" ? retake : onClose}
            disabled={!closeAllowed}
            aria-label={stage === "review" ? "Retake photo" : "Close proof capture"}
          >
            {stage === "review" ? <ArrowLeft size={20} /> : <X size={20} />}
          </button>
          <div className="capture-heading">
            <span>Live proof</span>
            <strong id="capture-title">{assignment.quest.title}</strong>
          </div>
          <div className={`session-timer ${secondsLeft < 30 ? "is-urgent" : ""}`}>
            <Clock3 size={15} /> {formatTimer(secondsLeft)}
          </div>
        </header>

        {(stage === "camera" || stage === "review") && (
          <>
            <div className={`camera-stage ${photo ? "has-photo" : ""}`}>
              {photo ? (
                <img src={photo} alt="Your captured quest proof" />
              ) : (
                <video ref={videoRef} playsInline muted aria-label="Live camera preview" />
              )}
              {!photo && <div className="camera-vignette" />}
              {!photo && (
                <div className="live-chip"><span /> LIVE · {session.sessionCode}</div>
              )}
              {!photo && cameraError && (
                <div className="camera-empty-state">
                  <Camera size={40} strokeWidth={1.4} />
                  <strong>Camera unavailable</strong>
                  <p>{cameraError}</p>
                  {galleryFallbackEnabled ? (
                    <label className="file-fallback">
                      <ImagePlus size={17} /> Device fallback
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        onChange={(event) => handleFile(event.target.files?.[0])}
                      />
                    </label>
                  ) : (
                    <span className="camera-required-note">Open IRLQuest on a camera-enabled device to continue.</span>
                  )}
                </div>
              )}
            </div>

            <div className="capture-instructions">
              <div className="challenge-icon"><QuestIcon size={23} /></div>
              <div>
                <span>Your live challenge</span>
                <strong>{session.challenge}</strong>
              </div>
              <div className="challenge-pending" title="Checked only after you submit the proof">
                <Clock3 size={14} />
                <span>Pending</span>
              </div>
            </div>

            <div className="capture-rule-row">
              {assignment.quest.rules.slice(0, 3).map((rule) => (
                <span key={rule}><Circle size={12} /> {rule}</span>
              ))}
            </div>

            {error && <div className="inline-error"><XCircle size={17} /> {error}</div>}

            <div className="capture-controls">
              {stage === "camera" ? (
                <>
                  <div className="capture-side-note"><LockKeyhole size={15} /> No photo is public</div>
                  <button className="shutter" type="button" onClick={captureFrame} disabled={Boolean(cameraError)}>
                    <span /><span className="sr-only">Capture photo</span>
                  </button>
                  {import.meta.env.DEV ? (
                    <button className="demo-capture" type="button" onClick={useDemoCapture}>Demo shot</button>
                  ) : <span className="capture-control-spacer" />}
                </>
              ) : (
                <>
                  <button className="secondary-button" type="button" onClick={retake}>
                    <RefreshCw size={17} /> Retake
                  </button>
                  <button className="primary-button" type="button" onClick={() => void handleSubmit()}>
                    Submit proof <Sparkles size={17} />
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {(stage === "submitting" || stage === "verifying") && (
          <div className="verification-state">
            <div className="verification-radar" aria-hidden="true">
              <span className="radar-ring ring-one" />
              <span className="radar-ring ring-two" />
              <span className="radar-ring ring-three" />
              <ShieldCheck size={48} />
            </div>
            <p className="result-eyebrow">Checking proof</p>
            <h2>{stage === "submitting" ? "Uploading…" : "One moment…"}</h2>
            <p>Reviewing your photo.</p>
            {error && <div className="inline-error"><XCircle size={17} /> {error}</div>}
            <button className="text-button" type="button" onClick={onClose} disabled={!closeAllowed}>
              Check later
            </button>
          </div>
        )}

        {stage === "result" && submission && (
          <div className={`result-state result-${submission.status}`}>
            <div className="result-badge">
              {submission.status === "accepted"
                ? <Check size={48} />
                : submission.status === "review"
                  ? <Clock3 size={48} />
                  : <X size={48} />}
            </div>
            <p className="result-eyebrow">
              {submission.status === "accepted"
                ? "Quest complete"
                : submission.status === "review"
                  ? "Try again later"
                  : "Not quite"}
            </p>
            <h2>
              {submission.status === "accepted"
                ? `+${submission.xp} XP banked.`
                : submission.status === "review"
                  ? "Couldn't verify this one."
                  : "Try another shot."}
            </h2>
            {submission.status === "rejected" && verdict?.summary && <p>{verdict.summary}</p>}
            <button className="primary-button result-button" type="button" onClick={onClose}>
              {submission.status === "accepted"
                ? "Back to today"
                : submission.status === "review"
                  ? "Back to quests"
                  : "Try again"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
