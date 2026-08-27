"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { MockupVectorLayer } from "@/lib/mockup-types";

type ArtworkPreview = {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
} | null;

function path2d(layer: MockupVectorLayer) {
  const path = new Path2D();
  for (const stroke of layer.strokes || []) {
    stroke.points.forEach((point, index) => {
      const x = (point.x / 1000) * 1024;
      const y = (point.y / 600) * 1024;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
  }
  return path;
}

function paintDesignTexture(
  canvas: HTMLCanvasElement,
  artwork: ArtworkPreview,
  vectors: MockupVectorLayer[],
) {
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve();
  context.clearRect(0, 0, canvas.width, canvas.height);

  const drawLayer = (layer: MockupVectorLayer) => {
    const cx = (layer.x / 100) * canvas.width;
    const cy = (layer.y / 100) * canvas.height;
    const width = (layer.width / 100) * canvas.width;
    const height = (layer.height / 100) * canvas.height;
    context.save();
    context.globalAlpha = layer.opacity ?? 1;
    context.translate(cx, cy);
    context.rotate((layer.rotation * Math.PI) / 180);
    context.translate(-cx, -cy);
    if (layer.kind === "text") {
      const fontPx = Math.max(22, height * 0.68);
      context.font = `${layer.fontWeight || 700} ${fontPx}px ${layer.fontFamily || "Arial"}`;
      context.textAlign = layer.textAlign || "center";
      context.textBaseline = "middle";
      context.fillStyle = layer.color || "#171717";
      const anchorX =
        layer.textAlign === "left"
          ? cx - width / 2
          : layer.textAlign === "right"
            ? cx + width / 2
            : cx;
      context.fillText(layer.text || "", anchorX, cy, width);
    } else {
      const drawingCanvas = document.createElement("canvas");
      drawingCanvas.width = drawingCanvas.height = 1024;
      const drawingContext = drawingCanvas.getContext("2d");
      if (drawingContext) {
        for (const stroke of layer.strokes || []) {
          drawingContext.save();
          drawingContext.globalAlpha =
            stroke.opacity ?? (stroke.tool === "marker" ? 0.5 : 1);
          drawingContext.strokeStyle =
            stroke.tool === "eraser" ? "rgba(0,0,0,1)" : stroke.color;
          drawingContext.lineWidth = stroke.width;
          drawingContext.lineCap = "round";
          drawingContext.lineJoin = "round";
          drawingContext.globalCompositeOperation =
            stroke.tool === "eraser" ? "destination-out" : "source-over";
          drawingContext.stroke(path2d({ ...layer, strokes: [stroke] }));
          drawingContext.restore();
        }
        context.drawImage(
          drawingCanvas,
          cx - width / 2,
          cy - height / 2,
          width,
          height,
        );
      }
    }
    context.restore();
  };

  const sortedVectors = [...vectors].sort((a, b) => a.zIndex - b.zIndex);
  const afterArtwork = () => sortedVectors.forEach(drawLayer);
  if (!artwork?.url) {
    afterArtwork();
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const cx = (artwork.x / 100) * canvas.width;
      const cy = (artwork.y / 100) * canvas.height;
      const width = (artwork.width / 100) * canvas.width;
      const height = (artwork.height / 100) * canvas.height;
      context.save();
      context.translate(cx, cy);
      context.rotate((artwork.rotation * Math.PI) / 180);
      context.drawImage(image, -width / 2, -height / 2, width, height);
      context.restore();
      afterArtwork();
      resolve();
    };
    image.onerror = () => {
      afterArtwork();
      resolve();
    };
    image.src = artwork.url;
  });
}

function makeGarmentShape(kind: "tee" | "polo" | "hoodie") {
  const shape = new THREE.Shape();
  shape.moveTo(-0.72, 2.05);
  shape.lineTo(-1.12, 1.88);
  shape.lineTo(kind === "hoodie" ? -2.2 : -2.0, kind === "hoodie" ? 0.4 : 1.24);
  shape.lineTo(
    kind === "hoodie" ? -1.72 : -1.55,
    kind === "hoodie" ? -0.05 : 0.52,
  );
  shape.lineTo(-1.05, 0.82);
  shape.lineTo(-1.0, -2.05);
  shape.lineTo(1.0, -2.05);
  shape.lineTo(1.05, 0.82);
  shape.lineTo(
    kind === "hoodie" ? 1.72 : 1.55,
    kind === "hoodie" ? -0.05 : 0.52,
  );
  shape.lineTo(kind === "hoodie" ? 2.2 : 2.0, kind === "hoodie" ? 0.4 : 1.24);
  shape.lineTo(1.12, 1.88);
  shape.lineTo(0.72, 2.05);
  shape.bezierCurveTo(0.58, 1.6, -0.58, 1.6, -0.72, 2.05);
  return shape;
}

function makeCurvedArtworkGeometry(front: boolean) {
  const geometry = new THREE.PlaneGeometry(1.78, 2.55, 24, 32);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const curve = 0.09 * (1 - Math.pow(x / 0.89, 2)) + 0.012 * Math.sin(y * 6);
    positions.setZ(index, front ? curve : -curve);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function StarterGarment3D({
  color,
  view,
  artwork,
  vectorLayers,
  onViewChange,
  kind = "tee",
}: {
  color: string;
  view: "front" | "back";
  artwork: ArtworkPreview;
  vectorLayers: MockupVectorLayer[];
  onViewChange: (view: "front" | "back") => void;
  kind?: "tee" | "polo" | "hoodie";
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | null>(null);
  const frontTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const backTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const targetRotationRef = useRef(view === "front" ? 0 : Math.PI);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f0e9);
    // Keep the complete garment in frame, including its hem. A little extra
    // breathing room also makes rotation feel less cramped on desktop.
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    // The mobile preview is nearly square, so the temporary garment needs a
    // little more camera distance than it does on a wide desktop preview.
    camera.position.set(0, -0.18, 12.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // This temporary geometry is deliberately clean and matte. Detailed cloth
    // folds will come from the production Blender models, rather than a noisy
    // simulated texture that can make a preview look lower quality.
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x756c63, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.25);
    key.position.set(-4, 6, 6);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.65);
    rim.position.set(4, 2, -5);
    scene.add(rim);

    const group = new THREE.Group();
    group.rotation.x = -0.03;
    groupRef.current = group;
    scene.add(group);

    const garmentMaterial = new THREE.MeshLambertMaterial({
      color,
      side: THREE.DoubleSide,
    });
    materialRef.current = garmentMaterial;
    const garment = new THREE.Mesh(
      new THREE.ExtrudeGeometry(makeGarmentShape(kind), {
        depth: 0.28,
        bevelEnabled: true,
        bevelSize: 0.11,
        bevelThickness: 0.09,
        bevelSegments: 5,
        curveSegments: 24,
      }),
      garmentMaterial,
    );
    garment.position.z = -0.14;
    garment.castShadow = true;
    garment.receiveShadow = true;
    group.add(garment);

    if (kind === "polo") {
      const placket = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.62, 0.035),
        new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
      );
      placket.position.set(0, 1.43, 0.36);
      group.add(placket);
    }

    const frontCanvas = document.createElement("canvas");
    frontCanvas.width = frontCanvas.height = 1024;
    const backCanvas = document.createElement("canvas");
    backCanvas.width = backCanvas.height = 1024;
    const frontTexture = new THREE.CanvasTexture(frontCanvas);
    const backTexture = new THREE.CanvasTexture(backCanvas);
    frontTexture.colorSpace = backTexture.colorSpace = THREE.SRGBColorSpace;
    frontTextureRef.current = frontTexture;
    backTextureRef.current = backTexture;
    const artMaterial = (map: THREE.CanvasTexture) =>
      new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        roughness: 0.78,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        side: THREE.DoubleSide,
      });
    const frontArt = new THREE.Mesh(
      makeCurvedArtworkGeometry(true),
      artMaterial(frontTexture),
    );
    frontArt.position.set(0, -0.05, 0.33);
    group.add(frontArt);
    const backArt = new THREE.Mesh(
      makeCurvedArtworkGeometry(false),
      artMaterial(backTexture),
    );
    backArt.position.set(0, -0.05, -0.33);
    backArt.rotation.y = Math.PI;
    group.add(backArt);

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(
        Math.max(1, rect.width),
        Math.max(1, rect.height),
        false,
      );
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const next = targetRotationRef.current;
      group.rotation.y += (next - group.rotation.y) * 0.12;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      garment.geometry.dispose();
      frontTexture.dispose();
      backTexture.dispose();
      mount.removeChild(renderer.domElement);
      groupRef.current = null;
      materialRef.current = null;
      frontTextureRef.current = null;
      backTextureRef.current = null;
    };
  }, [kind]);

  useEffect(() => {
    materialRef.current?.color.set(color);
  }, [color]);
  useEffect(() => {
    targetRotationRef.current = view === "front" ? 0 : Math.PI;
  }, [view]);
  useEffect(() => {
    const texture =
      view === "front" ? frontTextureRef.current : backTextureRef.current;
    if (!texture) return;
    void paintDesignTexture(
      texture.image as HTMLCanvasElement,
      artwork,
      vectorLayers,
    ).then(() => {
      texture.needsUpdate = true;
    });
  }, [view, artwork, vectorLayers]);

  function beginRotate(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    // React clears currentTarget after its handler returns. Keep the actual
    // element so releasing a drag cannot throw and leave rotation stuck.
    const target = event.currentTarget;
    const startX = event.clientX;
    const startRotation = targetRotationRef.current;
    setDragging(true);
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: React.PointerEvent<HTMLDivElement>) => {
      targetRotationRef.current =
        startRotation + (moveEvent.clientX - startX) * 0.012;
    };
    target.onpointermove = (moveEvent) =>
      move(moveEvent as unknown as React.PointerEvent<HTMLDivElement>);
    target.onpointerup = () => {
      setDragging(false);
      const normalized =
        ((targetRotationRef.current % (Math.PI * 2)) + Math.PI * 2) %
        (Math.PI * 2);
      const next =
        normalized > Math.PI / 2 && normalized < Math.PI * 1.5
          ? "back"
          : "front";
      targetRotationRef.current =
        next === "front"
          ? Math.round(targetRotationRef.current / (Math.PI * 2)) * Math.PI * 2
          : Math.round((targetRotationRef.current - Math.PI) / (Math.PI * 2)) *
              Math.PI *
              2 +
            Math.PI;
      onViewChange(next);
      target.onpointermove = null;
      target.onpointerup = null;
      target.onpointercancel = null;
    };
    target.onpointercancel = () => {
      setDragging(false);
      target.onpointermove = null;
      target.onpointerup = null;
      target.onpointercancel = null;
    };
  }

  return (
    <div
      className={`starterGarment3d isRotateEnabled ${dragging ? "isDragging" : ""}`}
    >
      <div
        className="starterGarment3dCanvas"
        ref={mountRef}
        onPointerDown={beginRotate}
        aria-label={`Interactive 3D ${kind} ${view} preview. Drag to rotate.`}
      />
      <div className="starterGarment3dControls">
        <div role="group" aria-label="Choose garment side">
          <button
            type="button"
            className={view === "front" ? "active" : ""}
            onClick={() => onViewChange("front")}
          >
            Front
          </button>
          <button
            type="button"
            className={view === "back" ? "active" : ""}
            onClick={() => onViewChange("back")}
          >
            Back
          </button>
        </div>
        <span className="starterGarment3dRotateHint">Drag or swipe to rotate</span>
      </div>
      <span className="starterGarment3dBadge">Interactive 3D preview</span>
      <span className="starterGarment3dEditHint">Preview only · Edit placement in 2D</span>
    </div>
  );
}
