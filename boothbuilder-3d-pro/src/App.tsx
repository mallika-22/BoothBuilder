import React, { Suspense, useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { 
  OrbitControls, 
  useGLTF, 
  ContactShadows, 
  Environment, 
  Html,
  Text,
  PerspectiveCamera,
  OrthographicCamera,
  Grid,
  TransformControls,
  useTexture,
  Center,
  useProgress
} from '@react-three/drei';
import * as THREE from 'three';
// @ts-ignore
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Draco setup
useGLTF.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
import { 
  Plus, 
  Minus, 
  Trash2, 
  Box, 
  Armchair, 
  Move, 
  Upload, 
  Info, 
  Copy, 
  Download, 
  Sun, 
  Moon,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Settings,
  Layers,
  Layout,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  RotateCcw,
  Camera,
  Bookmark,
  MapPin,
  Check,
  X,
  Edit2,
  Save,
  Lock,
  Unlock,
  Pipette,
  LayoutGrid
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- IndexedDB Persistence for GLB files ---
const DB_NAME = 'BoothBuilderDB';
const STORE_NAME = 'Assets';

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveAsset = async (id: string, blob: Blob) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(blob, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getAsset = async (id: string): Promise<Blob | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

const deleteAssetFromDB = async (id: string) => {
  const db = await initDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(id);
};

// --- Types ---

interface Furniture {
  id: string;
  type: 'Box' | 'Custom' | 'Plane';
  position: [number, number, number];
  rotation: [number, number, number];
  modelUrl: string; // Used for GLB or Texture image
  stockId?: string; // Reference to AssetStock
  color?: string;
  size?: [number, number]; // Specifically for Plane
  locked?: boolean;
}

interface AssetStock {
  id: string;
  name: string;
  url: string;
  thumbnailUrl?: string;
}

interface Viewpoint {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
}

const CAMERA_PRESETS: Record<string, Omit<Viewpoint, 'id'>> = {
  perspective: { name: 'Perspective', position: [8, 6, 8], target: [0, 1, 0] },
  top: { name: 'Top', position: [0, 15, 0.1], target: [0, 0, 0] },
  front: { name: 'Front', position: [0, 1.5, 12], target: [0, 1.5, 0] },
  left: { name: 'Left', position: [-12, 1.5, 0], target: [0, 1.5, 0] },
  right: { name: 'Right', position: [12, 1.5, 0], target: [0, 1.5, 0] },
  iso: { name: 'ISO', position: [10, 10, 10], target: [0, 0, 0] }
};

interface Project {
  id: string;
  name: string;
  updatedAt: number;
  thumbnail?: string;
}

/**
 * Generates a thumbnail for a GLB/GLTF model
 */
const generateThumbnail = async (url: string): Promise<string> => {
  if (!url || url === '' || url === 'null') return '';
  return new Promise((resolve) => {
    let renderer: THREE.WebGLRenderer | null = null;
    let dracoLoader: any = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(256, 256);
      renderer.setPixelRatio(1);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      
      const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
      scene.add(ambientLight);
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
      directionalLight.position.set(5, 5, 5);
      scene.add(directionalLight);

      // Load loaders dynamically
      Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/loaders/DRACOLoader.js')
      ]).then(([{ GLTFLoader }, { DRACOLoader }]) => {
        const loader = new GLTFLoader();
        dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
        loader.setDRACOLoader(dracoLoader);

        loader.load(url, (gltf: any) => {
          try {
            const model = gltf.scene;
            scene.add(model);

            const box = new THREE.Box3().setFromObject(model);
            if (box.isEmpty() || !isFinite(box.min.x)) {
              if (renderer) renderer.dispose();
              if (dracoLoader) dracoLoader.dispose();
              resolve('');
              return;
            }

            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            model.position.sub(center);

            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = camera.fov * (Math.PI / 180);
            let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
            cameraZ *= 2.0; 
            camera.position.set(cameraZ, cameraZ, cameraZ);
            camera.lookAt(0, 0, 0);

            // Re-render once to ensure everything is set
            renderer!.render(scene, camera);
            const dataUrl = renderer!.domElement.toDataURL('image/png');
            
            renderer!.dispose();
            if (dracoLoader) dracoLoader.dispose();
            resolve(dataUrl);
          } catch (ierr) {
            console.error('Thumbnail render error:', ierr);
            if (renderer) renderer.dispose();
            if (dracoLoader) dracoLoader.dispose();
            resolve('');
          }
        }, undefined, (err: any) => {
          // Check if it's a "glTF versions >=2.0 are supported" error or similar
          console.warn('Thumbnail load fail (likely non-gltf file):', err);
          if (renderer) renderer.dispose();
          if (dracoLoader) dracoLoader.dispose();
          resolve('');
        });
      }).catch(err => {
        console.error('Loader import error:', err);
        if (renderer) renderer.dispose();
        resolve('');
      });
    } catch (e) {
      console.error('Thumbnail gen fail:', e);
      if (renderer) renderer.dispose();
      resolve('');
    }
  });
};

function LoadingIndicator() {
  const { progress, active } = useProgress();

  if (!active) return null;
  
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-3 p-4 bg-black/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl scale-75 md:scale-100">
        <div className="relative w-16 h-16">
          <svg className="w-full h-full" viewBox="0 0 100 100">
            <circle 
              className="text-white/10 stroke-current" 
              strokeWidth="8" 
              fill="transparent" 
              r="40" 
              cx="50" 
              cy="50" 
            />
            <circle 
              className="text-indigo-500 stroke-current transition-all duration-300" 
              strokeWidth="8" 
              strokeDasharray={251.2}
              strokeDashoffset={251.2 * (1 - progress / 100)}
              strokeLinecap="round" 
              fill="transparent" 
              r="40" 
              cx="50" 
              cy="50" 
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-black text-white">{Math.round(progress)}%</span>
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-[10px] font-black text-white uppercase tracking-[0.2em] animate-pulse">Syncing Assets</div>
          <div className="text-[8px] text-slate-400 mt-1 uppercase font-bold tracking-widest">Optimizing Geometry</div>
        </div>
      </div>
    </div>
  );
}

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("Scene Error Catch:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      const errorMsg = this.state.error?.message || "";
      const isModelError = errorMsg.toLowerCase().includes("load") || errorMsg.toLowerCase().includes("gltf") || errorMsg.toLowerCase().includes("asset");

      if (isModelError) {
        return (
          <Html center>
            <div className="flex flex-col items-center justify-center p-2 bg-red-500/10 border border-red-500/30 rounded backdrop-blur-sm min-w-[80px]">
              <div className="text-red-500 text-[8px] uppercase font-black tracking-tighter">Load Error</div>
              <div className="text-slate-400 text-[6px] mt-0.5 truncate max-w-[60px]">Format Issue</div>
            </div>
          </Html>
        );
      }

      return (
        <Html center>
          <div className="flex flex-col items-center p-6 bg-red-500/10 border border-red-500/20 rounded-xl backdrop-blur-md">
            <h2 className="text-red-500 font-black uppercase text-sm mb-2">Graphics Engine Error</h2>
            <p className="text-slate-400 text-[10px] mb-4 text-center max-w-xs">{errorMsg || "Unknown error occurred while rendering the scene."}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-red-500 text-white rounded-lg font-bold text-[10px] uppercase shadow-lg shadow-red-500/20"
            >
              Restart Engine
            </button>
          </div>
        </Html>
      );
    }
    return this.props.children;
  }
}

function SnapshotGuide({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-[10] pointer-events-none flex items-center justify-center pointer-events-none overflow-hidden rounded-2xl overflow-hidden">
      {/* Darkened area outside the 16:9 frame */}
      <div className="absolute inset-0 bg-black/40" style={{ 
        clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 50% 50%, 0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%)' 
      }}>
        {/* Simple approach for darkened area using outline if clip-path is tricky */}
      </div>
      
      {/* Viewport frame 16:9 */}
      <div id="snapshot-guide-frame" className="relative aspect-video w-[95%] md:w-[85%] border-2 border-dashed border-indigo-500/40 shadow-[0_0_0_2000px_rgba(0,0,0,0.4)] flex items-center justify-center">
        {/* Center crosshair */}
        <div className="absolute w-4 h-[1px] bg-white/20" />
        <div className="absolute h-4 w-[1px] bg-white/20" />
        
        {/* Rule of thirds lines */}
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-10 pointer-events-none">
          <div className="border-r border-b border-indigo-300" />
          <div className="border-r border-b border-indigo-300" />
          <div className="border-b border-indigo-300" />
          <div className="border-r border-b border-indigo-300" />
          <div className="border-r border-b border-indigo-300" />
          <div className="border-b border-indigo-300" />
          <div className="border-r border-indigo-300" />
          <div className="border-r border-indigo-300" />
          <div />
        </div>
        
        {/* Frame indicators */}
        <div className="absolute top-0 left-0 p-3 flex flex-col gap-0.5">
          <div className="text-[9px] font-black text-white/50 uppercase tracking-widest font-mono">16:9 GUIDE</div>
          <div className="text-[7px] font-bold text-white/30 uppercase tracking-[0.2em] font-mono">1920x1080 TARGET</div>
        </div>
        
        <div className="absolute top-0 right-0 p-3 flex items-center gap-2">
           <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
           <span className="text-[8px] font-black text-white/50 uppercase tracking-widest font-mono">STBY</span>
        </div>
        
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white/40" />
        <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white/40" />
        <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white/40" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white/40" />
      </div>
    </div>
  );
}

// --- Components ---

/**
 * Placeholder model for when no GLB is uploaded
 */
function PlaceholderBox({ size = [2, 2.5, 2], color = "#cccccc" }: { size?: [number, number, number], color?: string }) {
  return (
    <mesh position={[0, size[1] / 2, 0]}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent opacity={0.3} wireframe />
    </mesh>
  );
}

function BoothModel({ modelUrl }: { modelUrl: string }) {
  if (!modelUrl || modelUrl === '' || modelUrl === 'null') return null;
  
  // Check if it's likely a GLB/GLTF by looking at our hack extension
  const isGltf = modelUrl.toLowerCase().includes('.glb') || modelUrl.toLowerCase().includes('.gltf');
  
  if (!isGltf && modelUrl.startsWith('blob:')) {
    console.warn("BoothModel: Skipping load for non-GLB/GLTF asset:", modelUrl);
    return <PlaceholderBox size={[2, 2.5, 2]} color="#94a3b8" />;
  }

  return <BoothModelInner modelUrl={modelUrl} />;
}

function BoothModelInner({ modelUrl }: { modelUrl: string }) {
  const { scene } = useGLTF(modelUrl);
  // @ts-ignore
  const clonedScene = React.useMemo(() => {
    if (!scene) return null;
    try {
      const clone = scene.clone(true);
      // Manually calculate bounds to force sit on ground
      const box = new THREE.Box3().setFromObject(clone);
      clone.position.y = -box.min.y;
      return clone;
    } catch (err) {
      console.error("Error cloning or centering booth model:", err);
      return scene.clone(true);
    }
  }, [scene]);

  return clonedScene ? (
    <primitive object={clonedScene} />
  ) : null;
}

function CustomFurnitureModel({ url }: { url: string }) {
  if (!url || url === '' || url === 'null') return null;

  // Check if it's likely a GLB/GLTF
  const isGltf = url.toLowerCase().includes('.glb') || url.toLowerCase().includes('.gltf');
  
  if (!isGltf && url.startsWith('blob:')) {
    console.warn("CustomFurnitureModel: Skipping load for non-GLB/GLTF asset:", url);
    return <PlaceholderBox size={[1, 1, 1]} color="#94a3b8" />;
  }

  return <CustomFurnitureModelInner url={url} />;
}

function CustomFurnitureModelInner({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  // @ts-ignore
  const clonedScene = React.useMemo(() => {
    if (!scene) return null;
    try {
      const clone = scene.clone(true);
      // Manually calculate bounds to force sit on ground
      const box = new THREE.Box3().setFromObject(clone);
      clone.position.y = -box.min.y;
      return clone;
    } catch (err) {
      console.error("Error cloning or centering furniture model:", err);
      return scene.clone(true);
    }
  }, [scene]);

  return clonedScene ? (
    <primitive object={clonedScene} />
  ) : null;
}

function ThumbnailManager({ 
  trigger, 
  onCapture 
}: { 
  trigger: boolean, 
  onCapture: (dataUrl: string) => void 
}) {
  const { gl, scene, camera } = useThree();
  
  React.useEffect(() => {
    if (trigger) {
      // Capture a small low-res thumbnail
      const originalSize = new THREE.Vector2();
      gl.getSize(originalSize);
      
      const thumbWidth = 240;
      const thumbHeight = 135; // 16:9

      gl.setSize(thumbWidth, thumbHeight, false);
      gl.render(scene, camera);
      const thumbnail = gl.domElement.toDataURL('image/jpeg', 0.6);
      
      // Restore
      gl.setSize(originalSize.x, originalSize.y, false);
      
      onCapture(thumbnail);
    }
  }, [trigger, gl, scene, camera, onCapture]);

  return null;
}

function ScreenshotManager({ trigger, onComplete }: { trigger: boolean, onComplete: () => void }) {
  const { gl, scene, camera } = useThree();
  
  React.useEffect(() => {
    if (trigger) {
      const guideFrame = document.getElementById('snapshot-guide-frame');
      
      // Save current state
      const originalSize = new THREE.Vector2();
      gl.getSize(originalSize);
      const originalPixelRatio = gl.getPixelRatio();
      const originalFov = (camera as THREE.PerspectiveCamera).fov;
      
      // Calculate crop factor if guide frame exists
      let fovFactor = 1;
      if (guideFrame) {
        const frameRect = guideFrame.getBoundingClientRect();
        const canvasRect = gl.domElement.getBoundingClientRect();
        fovFactor = frameRect.height / canvasRect.height;
      }
      
      // Set target resolution (1920x1080)
      const targetWidth = 1920;
      const targetHeight = 1080;
      
      // Temporarily resize
      gl.setPixelRatio(1);
      gl.setSize(targetWidth, targetHeight, false);
      
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = targetWidth / targetHeight;
        // Adjust FOV to match guide frame vertical extent
        camera.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(originalFov) / 2) * fovFactor));
        camera.updateProjectionMatrix();
      }

      // Force a render
      gl.render(scene, camera);
      
      // Capture
      const dataUrl = gl.domElement.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      link.download = `booth-capture-${new Date().getTime()}.png`;
      link.href = dataUrl;
      link.click();
      
      // Restore state
      gl.setPixelRatio(originalPixelRatio);
      gl.setSize(originalSize.x, originalSize.y, false);
      
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = originalSize.x / originalSize.y;
        camera.fov = originalFov;
        camera.updateProjectionMatrix();
      }

      onComplete();
    }
  }, [trigger, gl, scene, camera, onComplete]);

  return null;
}

function ViewpointHandler({ activeViewpoint, onMoveEnd, orbitRef }: { activeViewpoint: Viewpoint | null, onMoveEnd: () => void, orbitRef: React.RefObject<any> }) {
  const { camera } = useThree();
  
  React.useEffect(() => {
    if (activeViewpoint && orbitRef.current) {
      const controls = orbitRef.current;
      
      // Animate camera position and orbit target
      const startTime = Date.now();
      const duration = 1000;
      const startPos = camera.position.clone();
      const endPos = new THREE.Vector3(...activeViewpoint.position);
      const startTarget = controls.target.clone();
      const endTarget = new THREE.Vector3(...activeViewpoint.target);

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic

        camera.position.lerpVectors(startPos, endPos, ease);
        controls.target.lerpVectors(startTarget, endTarget, ease);
        controls.update();

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          onMoveEnd();
        }
      };

      requestAnimationFrame(animate);
    }
  }, [activeViewpoint, camera, orbitRef, onMoveEnd]);

  return null;
}

/**
 * Renders a single booth segment
 */
function BoothSegment({ position, modelUrls }: { position: [number, number, number], modelUrls: string[] }) {
  const validUrls = modelUrls.filter(url => url && url !== '' && url !== 'null');
  
  if (validUrls.length === 0) {
    return (
      <group position={position}>
        <PlaceholderBox size={[2, 2.4, 2]} color="#6366f1" />
        <Text
          position={[0, 1.2, 1.05]}
          fontSize={0.2}
          color="white"
          anchorX="center"
          anchorY="middle"
        >
          2x2 Segment
        </Text>
      </group>
    );
  }

  return (
    <group position={position}>
      {validUrls.map((url, i) => (
        <ErrorBoundary key={`${url}-${i}`}>
          <Suspense fallback={<PlaceholderBox size={[2, 2.4, 2]} />}>
            <BoothModel modelUrl={url} />
          </Suspense>
        </ErrorBoundary>
      ))}
    </group>
  );
}

// Furniture model component moved up for clarity and consistency
function FurnitureModelRenderer({ url, type }: { url: string, type: string }) {
  if (type === 'Plane') {
    return <PlaneModel url={url} />;
  }
  if (!url || url === '' || url === 'null') {
    return <PlaceholderBox size={[1, 1, 1]} color="#6366f1" />;
  }
  return (
    <ErrorBoundary>
      <Suspense fallback={<PlaceholderBox size={[1, 1, 1]} />}>
        <CustomFurnitureModel url={url} />
      </Suspense>
    </ErrorBoundary>
  );
}

function PlaneModel({ url }: { url: string }) {
  const texture = useTexture(url || 'https://via.placeholder.com/512?text=Image+Missing');
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial map={texture} transparent alphaTest={0.1} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * Furniture item in the scene
 */
function FurnitureItem({ 
  item, 
  onSelect, 
  isSelected 
}: { 
  item: Furniture, 
  onSelect: () => void, 
  isSelected: boolean 
}) {
  const meshRef = useRef<THREE.Group>(null);

  const lockIndicator = item.locked && isSelected ? (
    <Html distanceFactor={10} position={[0, 1.2, 0]}>
      <div className="bg-red-500 text-white p-1 rounded-full shadow-lg flex items-center justify-center animate-pulse">
        <Lock size={12} strokeWidth={3} />
      </div>
    </Html>
  ) : null;

  // Plane Item
  if (item.type === 'Plane') {
    return (
      <group 
        position={item.position} 
        rotation={item.rotation} 
        onClick={(e) => { 
          if (item.locked && !isSelected) return; 
          e.stopPropagation(); 
          onSelect(); 
        }}
      >
        <mesh position={[0, (item.size?.[1] || 1) / 2, 0]}>
          <planeGeometry args={item.size || [1, 1]} />
          {item.modelUrl && item.modelUrl !== '' && item.modelUrl !== 'null' ? (
            <ErrorBoundary>
              <React.Suspense fallback={<meshStandardMaterial color={item.color || "#ffffff"} />}>
                <TextureMaterial url={item.modelUrl} color={item.color} />
              </React.Suspense>
            </ErrorBoundary>
          ) : (
            <meshStandardMaterial color={item.color || "#ffffff"} side={THREE.DoubleSide} />
          )}
        </mesh>
        {isSelected && (
          <mesh position={[0, (item.size?.[1] || 1) / 2, 0.01]}>
            <planeGeometry args={[(item.size?.[0] || 1) + 0.1, (item.size?.[1] || 1) + 0.1]} />
            <meshStandardMaterial wireframe color={item.locked ? "#ef4444" : "#f59e0b"} />
          </mesh>
        )}
        {lockIndicator}
      </group>
    );
  }

  // Box Item (Placeholder)
  if (item.type === 'Box') {
    return (
      <group 
        position={item.position} 
        rotation={item.rotation} 
        onClick={(e) => { 
          if (item.locked && !isSelected) return; 
          e.stopPropagation(); 
          onSelect(); 
        }}
      >
        <mesh position={[0, 0.4, 0]}>
          <boxGeometry args={[0.6, 0.8, 0.6]} />
          <meshStandardMaterial 
            color={isSelected ? (item.locked ? "#ef4444" : "#f59e0b") : (item.color || "#94a3b8")} 
            emissive={isSelected ? (item.locked ? "#ef4444" : "#f59e0b") : "#000"}
            emissiveIntensity={0.5}
          />
        </mesh>
        {lockIndicator}
      </group>
    );
  }

  // Custom GLB Item
  return (
    <group 
      ref={meshRef}
      position={item.position}
      rotation={item.rotation}
      onClick={(e) => { 
        if (item.locked && !isSelected) return; 
        e.stopPropagation(); 
        onSelect(); 
      }}
    >
      {item.modelUrl && item.modelUrl !== '' && item.modelUrl !== 'null' ? (
        <ErrorBoundary>
          <Suspense fallback={<PlaceholderBox size={[0.5, 0.5, 0.5]} />}>
            <CustomFurnitureModel url={item.modelUrl} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <PlaceholderBox size={[0.5, 0.5, 0.5]} color="#f43f5e" />
      )}
      {isSelected && (
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[1.1, 1.1, 1.1]} />
          <meshStandardMaterial wireframe color={item.locked ? "#ef4444" : "#f59e0b"} />
        </mesh>
      )}
      {lockIndicator}
    </group>
  );
}

function TextureMaterial({ url, color }: { url: string, color?: string }) {
  const texture = useTexture(url);
  return <meshStandardMaterial map={texture} color={color || "#ffffff"} side={THREE.DoubleSide} transparent />;
}

/**
 * Main Scene
 */
function CameraSwitch({ viewMode, cameraView, orbitRef }: { viewMode: '3D' | '2D', cameraView: string, orbitRef: any }) {
  const { camera, size } = useThree();
  
  React.useEffect(() => {
    if (!orbitRef.current) return;

    const controls = orbitRef.current;
    let targetPos = [5, 5, 5];
    let targetLookAt = [0, 0, 0];

    if (cameraView === 'perspective') {
       targetPos = [5, 5, 5];
    } else {
      switch(cameraView) {
        case 'top': targetPos = [0, 10, 0]; break;
        case 'front': targetPos = [0, 0, 10]; break;
        case 'back': targetPos = [0, 0, -10]; break;
        case 'left': targetPos = [-10, 0, 0]; break;
        case 'right': targetPos = [10, 0, 0]; break;
        case 'bottom': targetPos = [0, -10, 0]; break;
      }
    }

    // Smooth transition
    const startTime = Date.now();
    const duration = 800;
    const startPos = camera.position.clone();
    const endPos = new THREE.Vector3(...targetPos);
    const startTarget = controls.target.clone();
    const endTarget = new THREE.Vector3(...targetLookAt);

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPos, endPos, ease);
      controls.target.lerpVectors(startTarget, endTarget, ease);
      controls.update();

      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [cameraView, orbitRef]);

  return (
    <>
      {viewMode === '2D' ? (
        <OrthographicCamera 
          makeDefault 
          position={[0, 10, 0]} 
          zoom={100} 
          near={-100} 
          far={1000} 
        />
      ) : (
        <PerspectiveCamera makeDefault position={[5, 5, 5]} fov={50} />
      )}
    </>
  );
}

function Scene({ 
  boothCount, 
  baseUnitSize,
  boothModelUrls, 
  boothPosition,
  boothRotation,
  furniture,
  selectedId,
  setSelectedId,
  onUpdatePosition,
  onUpdateRotation,
  boothLocked,
  envPreset,
  envIntensity,
  shadowsEnabled,
  envRotation,
  envHeight,
  envRadius,
  envScale,
  customEnvUrl,
  showBackground,
  groundEnabled,
  bgIntensity,
  bgRotation,
  showWorldCenter,
  theme,
  gizmoMode,
  exportRef,
  viewpointTrigger,
  setViewpointTrigger,
  activeViewpoint,
  setActiveViewpoint,
  viewMode,
  cameraView,
  isSnapshotting,
  onSnapshotComplete,
  thumbnailTrigger,
  onThumbnailCapture
}: { 
  boothCount: number, 
  baseUnitSize: [number, number],
  boothModelUrls: string[],
  boothPosition: [number, number, number],
  boothRotation: [number, number, number],
  furniture: Furniture[],
  selectedId: string | null,
  setSelectedId: (id: string | null) => void,
  onUpdatePosition: (id: string, position: [number, number, number]) => void,
  onUpdateRotation: (id: string, rotation: [number, number, number]) => void,
  boothLocked: boolean,
  envPreset: string,
  envIntensity: number,
  shadowsEnabled: boolean,
  envRotation: number,
  envHeight: number,
  envRadius: number,
  envScale: number,
  customEnvUrl: string | null,
  showBackground: boolean,
  groundEnabled: boolean,
  bgIntensity: number,
  bgRotation: number,
  showWorldCenter: boolean,
  theme: 'dark' | 'light',
  gizmoMode: 'translate' | 'rotate',
  exportRef: React.RefObject<THREE.Group>,
  viewpointTrigger: boolean,
  setViewpointTrigger: (val: boolean) => void,
  activeViewpoint: Viewpoint | null,
  setActiveViewpoint: (v: Viewpoint | null) => void,
  viewMode: '3D' | '2D',
  cameraView: string,
  isSnapshotting: boolean,
  onSnapshotComplete: () => void,
  thumbnailTrigger: boolean,
  onThumbnailCapture: (dataUrl: string) => void
}) {
  const [controlsEnabled, setControlsEnabled] = useState(true);
  const orbitRef = useRef<any>(null);

  const selectedObject = selectedId === BOOTH_BASE_ID 
    ? { position: boothPosition, rotation: boothRotation, locked: boothLocked }
    : furniture.find(f => f.id === selectedId);

  const selectedObjectPosition = selectedObject?.position;
  const selectedObjectRotation = selectedObject?.rotation;
  const isLocked = selectedObject?.locked || false;

  return (
    <>
      <ScreenshotManager trigger={isSnapshotting} onComplete={onSnapshotComplete} />
      <ThumbnailManager trigger={thumbnailTrigger} onCapture={onThumbnailCapture} />
      <ViewpointHandler activeViewpoint={activeViewpoint} onMoveEnd={() => setActiveViewpoint(null)} orbitRef={orbitRef} />
      
      <CameraSwitch viewMode={viewMode} cameraView={cameraView} orbitRef={orbitRef} />
      {!isSnapshotting && (
        <OrbitControls 
          ref={(ref) => {
            orbitRef.current = ref;
            if (ref) {
              // @ts-ignore
              window.getCurrentCamera = () => ({
                pos: ref.object.position.clone(),
                target: ref.target.clone()
              });
            }
          }}
          makeDefault 
          enabled={controlsEnabled}
          minPolarAngle={viewMode === '2D' ? 0 : 0} 
          maxPolarAngle={viewMode === '2D' ? Math.PI : Math.PI / 2.1} 
          enableRotate={viewMode === '3D'}
        />
      )}
      
      <ErrorBoundary>
        <Suspense fallback={null}>
          {shadowsEnabled && (
        <ContactShadows 
          position={[0, 0, 0]} 
          opacity={0.65} 
          scale={40} 
          blur={2} 
          far={10} 
          resolution={512} 
          color="#000000" 
        />
      )}
      
      {shadowsEnabled && (
        <ContactShadows 
          position={[0, 0.01, 0]} 
          opacity={0.65} 
          scale={40} 
          blur={2.5} 
          far={10} 
          resolution={512} 
          color="#000000" 
        />
      )}
      <Environment 
            key={`env-${envPreset}-${customEnvUrl || 'default'}-${groundEnabled}`}
            preset={(customEnvUrl && customEnvUrl !== '' && customEnvUrl !== 'null') ? undefined : envPreset as any} 
            files={(customEnvUrl && customEnvUrl !== '' && customEnvUrl !== 'null') ? customEnvUrl : undefined}
            background={groundEnabled} 
            blur={0} 
            environmentIntensity={envIntensity} 
            backgroundIntensity={bgIntensity}
            environmentRotation={[0, (envRotation + bgRotation) * Math.PI, 0] as any}
            backgroundRotation={[0, bgRotation * Math.PI, 0] as any}
            ground={groundEnabled ? {
              height: envHeight,
              radius: envRadius,
              scale: envScale
            } : undefined}
          />
        </Suspense>
      </ErrorBoundary>
      
      {!groundEnabled && (
        <color attach="background" args={[theme === 'dark' ? '#07080A' : '#ffffff']} />
      )}

      {!isSnapshotting && showWorldCenter && (
        <group>
          {/* Outer ring */}
          <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.2, 0.22, 64]} />
            <meshBasicMaterial color="#6366f1" transparent opacity={0.4} />
          </mesh>
          <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.08, 0.1, 64]} />
            <meshBasicMaterial color="#6366f1" />
          </mesh>
          {/* Inner core */}
          <mesh position={[0, 0.02, 0]}>
            <sphereGeometry args={[0.03, 16, 16]} />
            <meshBasicMaterial color="#6366f1" />
          </mesh>
          {/* Compass lines */}
          <mesh position={[0.4, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.8, 0.005]} />
            <meshBasicMaterial color="#ef4444" transparent opacity={0.6} />
          </mesh>
          <mesh position={[0, 0.01, 0.4]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
            <planeGeometry args={[0.8, 0.005]} />
            <meshBasicMaterial color="#3b82f6" transparent opacity={0.6} />
          </mesh>
        </group>
      )}

      <ambientLight intensity={theme === 'dark' ? 0.5 : 0.8} />
      <directionalLight 
        position={[10, 10, 5]} 
        intensity={1} 
        castShadow 
        shadow-mapSize={[1024, 1024]}
      />

      {!isSnapshotting && (
        <Grid 
          infiniteGrid 
          fadeDistance={25} 
          fadeStrength={5} 
          sectionSize={2} 
          cellSize={1} 
          sectionColor={theme === 'dark' ? "#444" : "#ccc"}
          cellColor={theme === 'dark' ? "#222" : "#eee"}
        />
      )}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <shadowMaterial opacity={0.4} />
      </mesh>

      <group ref={exportRef}>
        {/* Booth Segments */}
        <group 
          position={boothPosition} 
          rotation={boothRotation} 
          onClick={(e) => { 
            if (boothLocked && selectedId !== BOOTH_BASE_ID) return; // Prevent selection if locked
            e.stopPropagation(); 
            setSelectedId(BOOTH_BASE_ID); 
          }}
        >
          {Array.from({ length: boothCount }).map((_, i) => (
            <BoothSegment 
              key={i} 
              position={[(i - (boothCount - 1) / 2) * baseUnitSize[0], 0, 0]} 
              modelUrls={boothModelUrls} 
            />
          ))}
          {!isSnapshotting && selectedId === BOOTH_BASE_ID && (
            <mesh position={[0, 1.3, 0]}>
              <boxGeometry args={[boothCount * baseUnitSize[0] + 0.2, 2.6, baseUnitSize[1] + 0.2]} />
              <meshStandardMaterial wireframe color="#6366f1" transparent opacity={0.5} />
            </mesh>
          )}
        </group>

        {/* Furniture Items */}
        {furniture.map((item) => (
          <FurnitureItem 
            key={item.id} 
            item={item} 
            isSelected={!isSnapshotting && selectedId === item.id}
            onSelect={() => setSelectedId(item.id)}
          />
        ))}
      </group>

      {/* Transform Gizmo */}
      {!isSnapshotting && selectedId && !isLocked && (
        <TransformControls 
          position={selectedObjectPosition || [0, 0, 0]}
          rotation={selectedObjectRotation || [0, 0, 0]}
          mode={gizmoMode}
          space={gizmoMode === 'translate' ? 'world' : 'local'}
          onMouseDown={() => setControlsEnabled(false)}
          onMouseUp={() => {
            setControlsEnabled(true);
            // @ts-ignore
            if (window.onGizmoEnd) window.onGizmoEnd();
          }}
          onObjectChange={(e: any) => {
            if (e?.target?.object) {
              const { x, y, z } = e.target.object.position;
              const { x: rx, y: ry, z: rz } = e.target.object.rotation;
              
              if (gizmoMode === 'translate') {
                onUpdatePosition(selectedId, [x, y, z]);
              } else {
                onUpdateRotation(selectedId, [rx, ry, rz]);
              }
            }
          }}
        />
      )}

      <ContactShadows opacity={0.4} scale={15} blur={2.5} far={10} resolution={256} color="#000000" />
    </>
  );
}

// --- Main App ---

const BOOTH_BASE_ID = 'booth-base';

export default function App() {
  const [baseStocks, setBaseStocks] = useState<AssetStock[]>([]);
  const [assetStocks, setAssetStocks] = useState<AssetStock[]>([]);
  
  const [boothCount, setBoothCount] = useState(1);
  const [unitSize, setUnitSize] = useState<[number, number]>([2, 2]); // width, depth
  const [selectedBoothStockIds, setSelectedBoothStockIds] = useState<string[]>([]);
  const boothModelUrls = React.useMemo(() => {
    return baseStocks
      .filter(s => selectedBoothStockIds.includes(s.id))
      .map(s => s.url)
      .filter(url => url !== '');
  }, [baseStocks, selectedBoothStockIds]);

  const [boothPosition, setBoothPosition] = useState<[number, number, number]>([0, 0, 0]);
  const [boothRotation, setBoothRotation] = useState<[number, number, number]>([0, 0, 0]);
  const [boothLocked, setBoothLocked] = useState<boolean>(false);
  const [furniture, setFurniture] = useState<Furniture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');
  const [showGuideFrame, setShowGuideFrame] = useState(false);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [thumbnailTrigger, setThumbnailTrigger] = useState(false);

  const onThumbnailCapture = (thumbnail: string) => {
    setThumbnailTrigger(false);
    if (!currentProjectId) return;
    
    const updated = projects.map(p => p.id === currentProjectId ? { ...p, thumbnail } : p);
    setProjects(updated);
    localStorage.setItem(PROJECTS_LIST_KEY, JSON.stringify(updated));
  };
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [envPreset, setEnvPreset] = useState<string>('city');
  const [envIntensity, setEnvIntensity] = useState<number>(1);
  const [shadowsEnabled, setShadowsEnabled] = useState<boolean>(true);
  const [envRotation, setEnvRotation] = useState<number>(0);
  const [bgIntensity, setBgIntensity] = useState<number>(1);
  const [bgRotation, setBgRotation] = useState<number>(0);
  const [showBackground, setShowBackground] = useState<boolean>(true);
  const [envHeight, setEnvHeight] = useState<number>(1.5);
  const [envRadius, setEnvRadius] = useState<number>(100);
  const [envScale, setEnvScale] = useState<number>(100);
  const [customEnvUrl, setCustomEnvUrl] = useState<string | null>(null);
  const [customEnvName, setCustomEnvName] = useState<string | null>(null);
  const [groundEnabled, setGroundEnabled] = useState<boolean>(true);
  const [showWorldCenter, setShowWorldCenter] = useState<boolean>(true);
  const [viewpoints, setViewpoints] = useState<Viewpoint[]>([]);
  const [viewpointTrigger, setViewpointTrigger] = useState(false);
  const [activeViewpoint, setActiveViewpoint] = useState<Viewpoint | null>(null);

  const downloadViewpoints = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(viewpoints));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    const fileName = currentProjectName ? currentProjectName.replace(/\s+/g, '_') : 'project';
    downloadAnchorNode.setAttribute("download", `viewpoints_${fileName}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const viewpointsUploadRef = useRef<HTMLInputElement>(null);

  const handleImportViewpoints = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const imported = JSON.parse(content);
        if (Array.isArray(imported)) {
          // Re-generate IDs to avoid conflicts if needed, but simple merge for now
          const nextVps = [...viewpoints, ...imported.map((v: any) => ({
            ...v,
            id: v.id.startsWith('imported-') ? v.id : `imported-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
          }))];
          setViewpoints(nextVps);
          // @ts-ignore
          pushToHistory({ ...getSnapshot(), viewpoints: nextVps });
        } else {
          alert("Invalid viewpoints file format.");
        }
      } catch (error) {
        alert("Failed to parse viewpoints file. Please select a valid JSON file.");
        console.error("Failed to parse viewpoints file", error);
      }
    };
    reader.readAsText(file);
    if (event.target) event.target.value = '';
  };

  // Project Management States
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState<string>('Untitled Project');
  const [showEntryModal, setShowEntryModal] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState<string>('');

  const handleRenameProject = (projectId: string, newName: string) => {
    if (!newName.trim()) {
      setEditingProjectId(null);
      return;
    }
    
    // Update list state
    const updatedProjects = projects.map(p => p.id === projectId ? { ...p, name: newName, updatedAt: Date.now() } : p);
    setProjects(updatedProjects);
    
    // Persist list
    localStorage.setItem(PROJECTS_LIST_KEY, JSON.stringify(updatedProjects));
    
    // Update individual project data
    const savedRaw = localStorage.getItem(`booth-project-data-${projectId}`);
    if (savedRaw) {
      try {
        const saved = JSON.parse(savedRaw);
        saved.name = newName;
        localStorage.setItem(`booth-project-data-${projectId}`, JSON.stringify(saved));
      } catch (e) {
        console.error("Failed to update project name in storage", e);
      }
    }
    
    // If it's the current project, update state
    if (projectId === currentProjectId) {
      setCurrentProjectName(newName);
    }
    
    setEditingProjectId(null);
  };
  const [viewMode, setViewMode] = useState<'3D' | '2D'>('3D');
  const [cameraView, setCameraView] = useState<'perspective' | 'top' | 'front' | 'back' | 'left' | 'right'>('perspective');

  // UI States
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [expandedSections, setExpandedSections] = useState<string[]>(['structure', 'environment', 'base', 'explorer', 'library', 'stock', 'selection']);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => 
      prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
    );
  };

  const collapseAll = () => setExpandedSections([]);
  const expandAll = () => setExpandedSections(['structure', 'environment', 'base', 'explorer', 'library', 'stock', 'selection']);

  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  const resetProject = () => {
    setIsResetModalOpen(true);
  };

  const confirmReset = () => {
    setBoothCount(1);
    setUnitSize([2, 2]);
    setSelectedBoothStockIds([]);
    setBoothPosition([0, 0, 0]);
    setBoothRotation([0, 0, 0]);
    setFurniture([]);
    setSelectedId(null);
    setEnvPreset('city');
    setEnvIntensity(1);
    setEnvRotation(0);
    setBgIntensity(1);
    setBgRotation(0);
    setShowBackground(true);
    setEnvHeight(1.5);
    setEnvRadius(100);
    setEnvScale(100);
    setCustomEnvUrl(null);
    setCustomEnvName(null);
    setGroundEnabled(true);
    setShowWorldCenter(true);
    
    // Reset history
    const initialState = {
      boothCount: 1,
      unitSize: [2, 2],
      selectedBoothStockIds: [],
      boothPosition: [0, 0, 0],
      boothRotation: [0, 0, 0],
      boothLocked: false,
      furniture: [],
      envPreset: 'city',
      envIntensity: 1,
      envRotation: 0,
      bgIntensity: 1,
      bgRotation: 0,
      showBackground: true,
      groundEnabled: true,
      showWorldCenter: true,
      customEnvUrl: null,
      customEnvName: null,
      envHeight: 1.5,
      envRadius: 100,
      envScale: 100,
    };
    setHistory([initialState]);
    setHistoryIndex(0);
    
    // Clear storage
    localStorage.removeItem('booth-builder-state');
    setIsResetModalOpen(false);
  };

  // Stock Stocks
  const [isLoaded, setIsLoaded] = useState(false);

  // --- History Management ---
  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoingRedoing = useRef(false);

  const getSnapshot = () => ({
    boothCount,
    unitSize,
    selectedBoothStockIds,
    boothPosition,
    boothRotation,
    boothLocked,
    furniture: JSON.parse(JSON.stringify(furniture)), // Deep clone furniture array
    envPreset,
    envIntensity,
    envRotation,
    bgIntensity,
    bgRotation,
    showBackground,
    groundEnabled,
    showWorldCenter,
    customEnvUrl,
    customEnvName,
    envHeight,
    envRadius,
    envScale,
    viewpoints: JSON.parse(JSON.stringify(viewpoints)),
  });

  const pushToHistory = (snapshot?: any) => {
    if (isUndoingRedoing.current) return;
    
    const currentSnapshot = snapshot || getSnapshot();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(currentSnapshot);
    
    // Limit history size to 50
    if (newHistory.length > 50) newHistory.shift();
    
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      isUndoingRedoing.current = true;
      const prevIndex = historyIndex - 1;
      const snapshot = history[prevIndex];
      restoreFromSnapshot(snapshot);
      setHistoryIndex(prevIndex);
      setTimeout(() => { isUndoingRedoing.current = false; }, 10);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      isUndoingRedoing.current = true;
      const nextIndex = historyIndex + 1;
      const snapshot = history[nextIndex];
      restoreFromSnapshot(snapshot);
      setHistoryIndex(nextIndex);
      setTimeout(() => { isUndoingRedoing.current = false; }, 10);
    }
  };

  const restoreFromSnapshot = (s: any) => {
    setBoothCount(s.boothCount);
    setUnitSize(s.unitSize);
    setSelectedBoothStockIds(s.selectedBoothStockIds || []);
    setBoothPosition(s.boothPosition);
    setBoothRotation(s.boothRotation);
    setBoothLocked(s.boothLocked || false);
    setFurniture(s.furniture);
    setEnvPreset(s.envPreset);
    setEnvIntensity(s.envIntensity);
    setEnvRotation(s.envRotation);
    setBgIntensity(s.bgIntensity);
    setBgRotation(s.bgRotation);
    setShowBackground(s.showBackground);
    setGroundEnabled(s.groundEnabled ?? true);
    setShowWorldCenter(s.showWorldCenter ?? true);
    setCustomEnvUrl(s.customEnvUrl ?? null);
    setCustomEnvName(s.customEnvName ?? null);
    setEnvHeight(s.envHeight);
    setEnvRadius(s.envRadius);
    setEnvScale(s.envScale);
    setViewpoints(s.viewpoints || []);
  };

  // Initial history snapshot
  React.useEffect(() => {
    if (isLoaded && history.length === 0) {
      pushToHistory();
    }
  }, [isLoaded]);

  // Keyboard Shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  // Persistence Key
  const STORAGE_KEY = 'booth-builder-state-v2';
  const PROJECTS_LIST_KEY = 'booth-projects-list-v1';
  const LAST_PROJECT_KEY = 'booth-last-active-project';

  // Load state on mount - Modified to handle projects and auto-load
  React.useEffect(() => {
    const initProjects = async () => {
      try {
        const savedList = localStorage.getItem(PROJECTS_LIST_KEY);
        let projectList: Project[] = savedList ? JSON.parse(savedList) : [];
        
        // Migration: If old STORAGE_KEY exists and no projects, migrate it
        const oldState = localStorage.getItem(STORAGE_KEY);
        if (oldState && projectList.length === 0) {
          const migrationId = 'legacy-project';
          const migrationProject: Project = {
            id: migrationId,
            name: 'Migrated Project',
            updatedAt: Date.now()
          };
          projectList = [migrationProject];
          localStorage.setItem(`booth-project-data-${migrationId}`, oldState);
          localStorage.setItem(PROJECTS_LIST_KEY, JSON.stringify(projectList));
        }

        setProjects(projectList);
        
        // Auto-load last project
        const lastId = localStorage.getItem(LAST_PROJECT_KEY);
        if (lastId && projectList.find(p => p.id === lastId)) {
          console.log('Auto-loading last project:', lastId);
          loadProject(lastId);
        } else if (projectList.length === 0) {
          setIsLoaded(true); // Nothing to load, just show modal
        } else {
          setIsLoaded(true); // Show entry modal
        }
      } catch (e) {
        console.error('Failed to init projects:', e);
        setIsLoaded(true);
      }
    };

    initProjects();
  }, []);

  const loadProject = async (projectId: string) => {
    console.log('Loading project:', projectId);
    try {
      const savedRaw = localStorage.getItem(`booth-project-data-${projectId}`);
      if (!savedRaw) {
        setIsLoaded(true);
        return;
      }

      const saved = JSON.parse(savedRaw);
      
      // Update last active project
      localStorage.setItem(LAST_PROJECT_KEY, projectId);
      
      setCurrentProjectId(projectId);
      setCurrentProjectName(saved.name || projects.find(p => p.id === projectId)?.name || 'Untitled');
      setIsResetModalOpen(false);
      setShowEntryModal(false);
      setIsLoaded(false); 

      // Restore basic states
      setBoothCount(saved.boothCount || 1);
      setUnitSize(saved.unitSize || [2, 2]);
      setBoothPosition(saved.boothPosition || [0, 0, 0]);
      setBoothRotation(saved.boothRotation || [0, 0, 0]);
      setTheme(saved.theme || 'dark');
      setEnvPreset(saved.envPreset || 'city');
      setEnvIntensity(saved.envIntensity ?? 1);
      setEnvRotation(saved.envRotation || 0);
      setBgIntensity(saved.bgIntensity ?? 1);
      setBgRotation(saved.bgRotation || 0);
      setShowBackground(saved.showBackground ?? true);
      setGroundEnabled(saved.groundEnabled ?? true);
      setShowWorldCenter(saved.showWorldCenter ?? true);
      setEnvHeight(saved.envHeight ?? 1.5);
      setEnvRadius(saved.envRadius ?? 100);
      setEnvScale(saved.envScale ?? 100);
      setViewpoints(saved.viewpoints || []);

      // Reconstruct all Assets from IndexedDB
      // We do this in a specific order to ensure dependency resolution

      // 1. Environment
      if (saved.hasCustomEnv || saved.customEnvName) {
        const blob = await getAsset('custom-env');
        if (blob) {
          const url = URL.createObjectURL(blob);
          const ext = (saved.customEnvName || '').split('.').pop()?.toLowerCase();
          setCustomEnvUrl(url + (ext ? `#.${ext}` : ''));
          setCustomEnvName(saved.customEnvName);
        }
      }

      // 2. Base Stocks (Booth Modules)
      const restoredBaseStocks = await Promise.all((saved.baseStocks || []).map(async (stock: AssetStock) => {
        const blob = await getAsset(stock.id);
        if (blob) {
          const ext = stock.name.split('.').pop()?.toLowerCase() || 'glb';
          return { ...stock, url: URL.createObjectURL(blob) + `#.${ext}` };
        }
        return { ...stock, url: '' }; // Mark as missing if no blob
      }));
      setBaseStocks(restoredBaseStocks);

      // 3. Asset Stocks (Furniture Templates)
      const restoredAssetStocks = await Promise.all((saved.assetStocks || []).map(async (stock: AssetStock) => {
        const blob = await getAsset(stock.id);
        if (blob) {
          const ext = stock.name.split('.').pop()?.toLowerCase() || 'glb';
          return { ...stock, url: URL.createObjectURL(blob) + `#.${ext}` };
        }
        return { ...stock, url: '' };
      }));
      setAssetStocks(restoredAssetStocks);

      // 4. Active Furniture Instances
      const restoredFurniture = await Promise.all((saved.furniture || []).map(async (f: Furniture) => {
        // A. If it's a Custom or Plane object and has its own dedicated blob (unique per instance)
        const blob = await getAsset(f.id);
        if (blob) {
          const ext = f.type === 'Plane' ? 'png' : 'glb';
          return { ...f, modelUrl: URL.createObjectURL(blob) + `#.${ext}` };
        }

        // B. If it points to an AssetStock (shared asset)
        if (f.stockId) {
          const match = restoredAssetStocks.find(s => s.id === f.stockId);
          if (match && match.url) {
            return { ...f, modelUrl: match.url };
          }
        }
        
        return f;
      }));
      setFurniture(restoredFurniture);

      // 5. Active Booth Wall Modules
      if (saved.selectedBoothStockIds) {
        setSelectedBoothStockIds(saved.selectedBoothStockIds);
      } else if (saved.selectedBoothStockId) {
        setSelectedBoothStockIds([saved.selectedBoothStockId]);
      } else {
        setSelectedBoothStockIds([]);
      }

      console.log('Project loaded successfully');
      setIsLoaded(true);
    } catch (e) {
      console.error('Failed to load project:', e);
      setIsLoaded(true);
    }
  };

  const createNewProject = (name: string = 'New Project') => {
    const id = `project-${Date.now()}`;
    const newProject: Project = {
      id,
      name,
      updatedAt: Date.now()
    };
    
    const newList = [...projects, newProject];
    setProjects(newList);
    localStorage.setItem(PROJECTS_LIST_KEY, JSON.stringify(newList));
    localStorage.setItem(LAST_PROJECT_KEY, id);
    
    // Clear current state to defaults
    setBoothCount(1);
    setUnitSize([2, 2]);
    setSelectedBoothStockIds([]);
    setBoothPosition([0, 0, 0]);
    setBoothRotation([0, 0, 0]);
    setFurniture([]);
    setSelectedId(null);
    setEnvPreset('city');
    setEnvIntensity(1);
    setEnvRotation(0);
    setBgIntensity(1);
    setBgRotation(0);
    setShowBackground(true);
    setEnvHeight(1.5);
    setEnvRadius(100);
    setEnvScale(100);
    setCustomEnvUrl(null);
    setCustomEnvName(null);
    setGroundEnabled(true);
    setShowWorldCenter(true);
    setViewpoints([]);
    
    setCurrentProjectId(id);
    setCurrentProjectName(name);
    setShowEntryModal(false);
    setIsLoaded(true);
    setHistory([]);
    setHistoryIndex(0);
  };

  const confirmDeleteProject = (projectId: string) => {
    const newList = projects.filter(p => p.id !== projectId);
    setProjects(newList);
    localStorage.setItem(PROJECTS_LIST_KEY, JSON.stringify(newList));
    localStorage.removeItem(`booth-project-data-${projectId}`);
    
    if (currentProjectId === projectId) {
      setCurrentProjectId(null);
      setShowEntryModal(true);
    }
    setProjectToDelete(null);
  };

  const deleteProject = (projectId: string) => {
    setProjectToDelete(projectId);
  };

  // Save state on changes - Modified for multi-project
  React.useEffect(() => {
    if (!isLoaded || !currentProjectId) return;

    const stateToSave = {
      boothCount,
      unitSize,
      boothPosition,
      boothRotation,
      furniture: furniture.map(f => ({ ...f, modelUrl: f.modelUrl.startsWith('blob:') ? '' : f.modelUrl })), 
      baseStocks: baseStocks.map(s => ({ ...s, url: '' })),
      assetStocks: assetStocks.map(s => ({ ...s, url: '' })),
      selectedBoothStockIds,
      theme,
      envPreset,
      envIntensity,
      envRotation,
      bgIntensity,
      bgRotation,
      showBackground,
      groundEnabled,
      showWorldCenter,
      viewpoints,
      envHeight,
      envRadius,
      envScale,
      customEnvName
    };

    localStorage.setItem(`booth-project-data-${currentProjectId}`, JSON.stringify(stateToSave));
    
    // Update last active
    localStorage.setItem(LAST_PROJECT_KEY, currentProjectId);
    
    // Also update updatedAt in projects list
    const newList = projects.map(p => p.id === currentProjectId ? { ...p, updatedAt: Date.now() } : p);
    // Sort projects by updatedAt
    const sortedList = [...newList].sort((a, b) => b.updatedAt - a.updatedAt);
    setProjects(sortedList);
    localStorage.setItem(PROJECTS_LIST_KEY, JSON.stringify(sortedList));

  }, [boothCount, unitSize, boothPosition, boothRotation, furniture, baseStocks, assetStocks, boothModelUrls, theme, isLoaded, envPreset, envIntensity, envRotation, bgIntensity, bgRotation, showBackground, groundEnabled, showWorldCenter, viewpoints, envHeight, envRadius, envScale, customEnvUrl, currentProjectId]);

  // Debounced effect to trigger thumbnail capture
  useEffect(() => {
    if (!isLoaded || !currentProjectId) return;
    
    const timeout = setTimeout(() => {
      setThumbnailTrigger(true);
    }, 2000); // Wait 2s after changes before capturing thumbnail
    
    return () => clearTimeout(timeout);
  }, [currentProjectId, isLoaded, boothCount, unitSize, boothPosition, boothRotation, furniture, envPreset, envIntensity, customEnvUrl]);

  const removeBaseStock = (id: string) => {
    const stock = baseStocks.find(s => s.id === id);
    if (stock) {
      setSelectedBoothStockIds(prev => prev.filter(sid => sid !== id));
    }
    setBaseStocks(baseStocks.filter(s => s.id !== id));
    deleteAssetFromDB(id);
  };

  const removeAssetStock = (id: string) => {
    setAssetStocks(assetStocks.filter(s => s.id !== id));
    deleteAssetFromDB(id);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const furnitureInputRef = useRef<HTMLInputElement>(null);
  const planeInputRef = useRef<HTMLInputElement>(null);
  const envUploadRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<THREE.Group>(null);

  const handleExportGLB = () => {
    if (!exportRef.current) return;
    const exporter = new GLTFExporter();
    exporter.parse(
      exportRef.current,
      (result) => {
        const link = document.createElement('a');
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: 'application/octet-stream' });
          link.href = URL.createObjectURL(blob);
          link.download = 'booth-design.glb';
        } else {
          const output = JSON.stringify(result, null, 2);
          const blob = new Blob([output], { type: 'text/plain' });
          link.href = URL.createObjectURL(blob);
          link.download = 'booth-design.gltf';
        }
        link.click();
      },
      (error) => {
        console.error('Export failed:', error);
      },
      { binary: true, animations: [] }
    );
  };

  const handleBoothUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'glb';
      if (ext !== 'glb' && ext !== 'gltf') {
        alert('Please upload a .glb or .gltf file for booth modules.');
        return;
      }
      const id = Math.random().toString(36).substr(2, 9);
      await saveAsset(id, file); // Store blob in IndexedDB
      const url = URL.createObjectURL(file);
      const urlWithExt = url + `#.${ext}`;
      const thumb = await generateThumbnail(urlWithExt);
      const newStock: AssetStock = {
        id: id,
        name: file.name,
        url: urlWithExt,
        thumbnailUrl: thumb
      };
      const updatedBaseStocks = [...baseStocks, newStock];
      setBaseStocks(updatedBaseStocks);
      setSelectedBoothStockIds([id]);
      setSelectedId(BOOTH_BASE_ID);
      pushToHistory({ ...getSnapshot(), baseStocks: updatedBaseStocks, selectedBoothStockIds: [id] });
    }
  };

  const handleFurnitureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'glb';
      if (ext !== 'glb' && ext !== 'gltf') {
        alert('Please upload a .glb or .gltf file for furniture.');
        return;
      }
      const id = Math.random().toString(36).substr(2, 9);
      await saveAsset(id, file); // Store blob in IndexedDB
      const url = URL.createObjectURL(file);
      const urlWithExt = url + `#.${ext}`;
      const thumb = await generateThumbnail(urlWithExt);
      const newStock: AssetStock = {
        id: id,
        name: file.name,
        url: urlWithExt,
        thumbnailUrl: thumb
      };
      const updatedStocks = [...assetStocks, newStock];
      setAssetStocks(updatedStocks);
      addFurniture(urlWithExt, 'Custom', id, id);
      pushToHistory({ ...getSnapshot(), assetStocks: updatedStocks });
    }
  };

  const handlePlaneImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedId && selectedItem?.type === 'Plane') {
      await saveAsset(selectedId, file); // Store blob in IndexedDB linked to item ID
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const url = URL.createObjectURL(file) + `#.${ext}`;
      const newFurniture = furniture.map(f => f.id === selectedId ? { ...f, modelUrl: url } : f);
      setFurniture(newFurniture);
      pushToHistory({ ...getSnapshot(), furniture: newFurniture });
    }
  };

  const handleCustomEnvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await saveAsset('custom-env', file);
      const url = URL.createObjectURL(file);
      const ext = file.name.split('.').pop()?.toLowerCase();
      const newUrl = url + (ext ? `#.${ext}` : '');
      setCustomEnvUrl(newUrl);
      setCustomEnvName(file.name);
      pushToHistory({ ...getSnapshot(), customEnvUrl: newUrl, customEnvName: file.name });
    }
  };

  const addFurniture = (url: string = '', type: 'Box' | 'Custom' | 'Plane' = 'Box', existingId?: string, stockId?: string) => {
    const id = existingId || Math.random().toString(36).substr(2, 9);
    const newItem: Furniture = {
      id: id,
      type: url ? (type === 'Plane' ? 'Plane' : 'Custom') : type,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      modelUrl: url,
      stockId: stockId,
      color: "#ffffff",
      size: type === 'Plane' ? [1, 1] : undefined
    };
    const newFurniture = [...furniture, newItem];
    setFurniture(newFurniture);
    setSelectedId(newItem.id);
    pushToHistory({ ...getSnapshot(), furniture: newFurniture });
  };

  const updateFurnitureColor = (color: string) => {
    if (!selectedId) return;
    const newFurniture = furniture.map(f => f.id === selectedId ? { ...f, color } : f);
    setFurniture(newFurniture);
    pushToHistory({ ...getSnapshot(), furniture: newFurniture });
  };

  const updatePlaneSize = (delta: number, isWidth: boolean) => {
    if (!selectedId || selectedItem?.type !== 'Plane') return;
    const newFurniture = furniture.map(f => {
      if (f.id === selectedId) {
        const newSize = [...(f.size || [1, 1])] as [number, number];
        if (isWidth) newSize[0] = Math.max(0.1, newSize[0] + delta);
        else newSize[1] = Math.max(0.1, newSize[1] + delta);
        return { ...f, size: newSize };
      }
      return f;
    });
    setFurniture(newFurniture);
    pushToHistory({ ...getSnapshot(), furniture: newFurniture });
  };

  const updatePlaneSizeValue = (val: number, isWidth: boolean) => {
    if (!selectedId || selectedItem?.type !== 'Plane') return;
    const newFurniture = furniture.map(f => {
      if (f.id === selectedId) {
        const newSize = [...(f.size || [1, 1])] as [number, number];
        if (isWidth) newSize[0] = Math.max(0.1, val);
        else newSize[1] = Math.max(0.1, val);
        return { ...f, size: newSize };
      }
      return f;
    });
    setFurniture(newFurniture);
    pushToHistory({ ...getSnapshot(), furniture: newFurniture });
  };

  const duplicateFurniture = () => {
    if (!selectedId || selectedId === BOOTH_BASE_ID || !selectedItem) return;
    const id = Math.random().toString(36).substr(2, 9);
    const newItem: Furniture = {
      ...(selectedItem as Furniture),
      id: id,
      position: [selectedItem.position[0] + 4, selectedItem.position[1], selectedItem.position[2]],
    };
    const newFurniture = [...furniture, newItem];
    setFurniture(newFurniture);
    setSelectedId(newItem.id);
    pushToHistory({ ...getSnapshot(), furniture: newFurniture });
  };

  const removeFurniture = (id: string) => {
    if (id === BOOTH_BASE_ID) {
      setSelectedBoothStockIds([]);
      setBoothCount(1);
      setBoothPosition([0, 0, 0]);
      setBoothRotation([0, 0, 0]);
      setSelectedId(null);
      pushToHistory();
      return;
    }
    const newFurniture = furniture.filter(f => f.id !== id);
    setFurniture(newFurniture);
    if (selectedId === id) setSelectedId(null);
    pushToHistory({ ...getSnapshot(), furniture: newFurniture });
  };

  const updatePosition = (axis: 'x' | 'y' | 'z', delta: number) => {
    if (!selectedId) return;

    if (selectedId === BOOTH_BASE_ID) {
      const newPos = [...boothPosition] as [number, number, number];
      const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      newPos[idx] += delta;
      setBoothPosition(newPos);
      return;
    }

    setFurniture(furniture.map(f => {
      if (f.id === selectedId) {
        if (f.locked) return f;
        const newPos = [...f.position] as [number, number, number];
        const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        newPos[idx] += delta;
        return { ...f, position: newPos };
      }
      return f;
    }));
  };

  const rotateSelected = (axis: 'x' | 'y' | 'z', delta: number) => {
    if (!selectedId) return;

    if (selectedId === BOOTH_BASE_ID) {
      const newRot = [...boothRotation] as [number, number, number];
      const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      newRot[idx] += delta;
      setBoothRotation(newRot);
      return;
    }

    setFurniture(furniture.map(f => {
      if (f.id === selectedId) {
        if (f.locked) return f;
        const newRot = [...f.rotation] as [number, number, number];
        const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        newRot[idx] += delta;
        return { ...f, rotation: newRot };
      }
      return f;
    }));
  };

  const toggleLockSelected = () => {
    if (!selectedId) return;
    if (selectedId === BOOTH_BASE_ID) {
      setBoothLocked(!boothLocked);
      pushToHistory({ ...getSnapshot(), boothLocked: !boothLocked });
      return;
    }
    const newFurniture = furniture.map(f => f.id === selectedId ? { ...f, locked: !f.locked } : f);
    setFurniture(newFurniture);
    pushToHistory({ ...getSnapshot(), furniture: newFurniture });
  };

  const setPositionFromGizmo = (id: string, position: [number, number, number]) => {
    if (id === BOOTH_BASE_ID) {
      setBoothPosition(position);
    } else {
      setFurniture(furniture.map(f => {
        if (f.id === id) {
          if (f.locked) return f;
          return { ...f, position };
        }
        return f;
      }));
    }
    // We snapshot on gizmo end via Scene component or here if we want immediate
    // ActuallyScene handles onMouseUp usually or we can debounced snapshot
  };

  const setRotationFromGizmo = (id: string, rotation: [number, number, number]) => {
    if (id === BOOTH_BASE_ID) {
      setBoothRotation(rotation);
    } else {
      setFurniture(furniture.map(f => {
        if (f.id === id) {
           if (f.locked) return f;
           return { ...f, rotation };
        }
        return f;
      }));
    }
  };

  // Expose pushToHistory for TransformControls
  React.useEffect(() => {
    // @ts-ignore
    window.onGizmoEnd = () => {
      pushToHistory();
    };
  }, [boothPosition, boothRotation, furniture]);

  const triggerSnapshot = () => {
    setIsSnapshotting(true);
    setTimeout(() => {
      setViewpointTrigger(true);
    }, 100);
  };

  const onSnapshotComplete = () => {
    setViewpointTrigger(false);
    setIsSnapshotting(false);
  };

  const selectedItem = selectedId === BOOTH_BASE_ID 
    ? { id: BOOTH_BASE_ID, type: 'Structural Base' as const, position: boothPosition, rotation: boothRotation, locked: true }
    : furniture.find(f => f.id === selectedId);

  return (
    <div className={`w-full h-screen font-sans flex flex-col overflow-hidden transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0A0B0E] text-slate-200' : 'bg-slate-50 text-slate-800'}`}>
      <LoadingIndicator />
      {/* Header Navigation */}
      <header className={`h-16 border-b flex items-center justify-between px-6 z-30 transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0F1116] border-white/10' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Box className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className={`text-sm font-bold tracking-tight uppercase ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>BoothBuilder <span className="text-indigo-400">v2.0</span></h1>
            <div className="flex items-center gap-1.5 overflow-hidden">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-medium truncate">Interactive 3D Workspace</p>
              {currentProjectId && (
                <>
                  <span className="text-[8px] text-slate-700">•</span>
                  <span className="text-[10px] text-indigo-500 font-bold truncate max-w-[150px]">PROJECT: {currentProjectName}</span>
                </>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className={`flex items-center border rounded-lg p-0.5 ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
            <button 
              onClick={undo}
              disabled={historyIndex <= 0}
              className={`p-1.5 rounded transition-all ${historyIndex > 0 ? 'hover:bg-indigo-500/20 text-indigo-400' : 'text-slate-600 opacity-30 cursor-not-allowed'}`}
              title="Undo (Ctrl+Z)"
            >
              <div className="w-4 h-4 flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>
              </div>
            </button>
            <div className={`w-[1px] h-3 mx-1 ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-300'}`}></div>
            <button 
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              className={`p-1.5 rounded transition-all ${historyIndex < history.length - 1 ? 'hover:bg-indigo-500/20 text-indigo-400' : 'text-slate-600 opacity-30 cursor-not-allowed'}`}
              title="Redo (Ctrl+Y)"
            >
              <div className="w-4 h-4 flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg>
              </div>
            </button>
          </div>

          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`p-2 rounded-lg border transition-all flex items-center justify-center ${theme === 'dark' ? 'bg-white/5 border-white/10 text-yellow-400 hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200 shadow-sm'}`}
            title="Toggle Theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <div className={`w-[1px] h-6 mx-1 ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-300'}`}></div>

          <button 
            onClick={() => setShowEntryModal(true)}
            className={`p-2 rounded-lg border transition-all flex items-center gap-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-indigo-400 hover:text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-indigo-600 hover:bg-slate-200 shadow-sm'}`}
            title="My Projects"
          >
            <Layers size={16} />
            <span className="text-[10px] font-bold uppercase hidden md:inline">Projects</span>
          </button>

          <button 
            onClick={expandedSections.length > 0 ? collapseAll : expandAll}
            className={`p-2 rounded-lg border transition-all flex items-center gap-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900 shadow-sm'}`}
            title={expandedSections.length > 0 ? "Collapse All Sections" : "Expand All Sections"}
          >
            {expandedSections.length > 0 ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            <span className="text-[10px] font-bold uppercase hidden md:inline">
              {expandedSections.length > 0 ? "Collapse UI" : "Expand UI"}
            </span>
          </button>

          <button 
            onClick={resetProject}
            className={`p-2 rounded-lg border transition-all flex items-center gap-2 ${theme === 'dark' ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20' : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 shadow-sm'}`}
            title="Clean Project (Reset)"
          >
            <RotateCcw size={16} />
            <span className="text-[10px] font-bold uppercase hidden md:inline">Clean</span>
          </button>

          <div className="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-[10px] text-green-500 font-bold uppercase">Live Engine Active</span>
          </div>
          <button 
            onClick={handleExportGLB}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-bold rounded-md transition-colors shadow-lg shadow-indigo-600/20 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            EXPORT GLB
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar Toggle Buttons */}
        <button 
          onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
          className={`absolute top-4 left-0 z-40 p-1.5 rounded-r-md border transition-all ${leftSidebarOpen ? '-translate-x-full' : 'translate-x-0'} ${theme === 'dark' ? 'bg-[#0F1116] border-white/10 text-slate-400 hover:text-white' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900 shadow-md'}`}
          title={leftSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
        >
          {leftSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>

        <button 
          onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
          className={`absolute top-4 right-0 z-40 p-1.5 rounded-l-md border transition-all ${rightSidebarOpen ? 'translate-x-full' : 'translate-x-0'} ${theme === 'dark' ? 'bg-[#0F1116] border-white/10 text-slate-400 hover:text-white' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900 shadow-md'}`}
          title={rightSidebarOpen ? "Hide Panel" : "Show Panel"}
        >
          {rightSidebarOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        {/* Left Panel: Structural Controls */}
        <motion.aside 
          initial={false}
          animate={{ width: leftSidebarOpen ? 288 : 0, opacity: leftSidebarOpen ? 1 : 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className={`border-r flex flex-col z-20 transition-colors duration-300 overflow-hidden ${theme === 'dark' ? 'bg-[#0F1116] border-white/10' : 'bg-white border-slate-200 shadow-xl shadow-slate-200/50'}`}
        >
          <div className="w-72 p-6 flex flex-col gap-6 h-full overflow-y-auto overflow-x-hidden custom-scrollbar">
            <section className="flex flex-col">
              <button 
                onClick={() => toggleSection('structure')}
                className="flex items-center justify-between w-full text-left mb-2 group"
              >
                <div className="flex items-center gap-2">
                   <Layout size={12} className="text-slate-500" />
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Structure Modules</h2>
                </div>
                {expandedSections.includes('structure') ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
              </button>
              
              <AnimatePresence>
                {expandedSections.includes('structure') && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className={`border rounded-xl p-4 flex flex-col gap-4 mb-4 ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase text-slate-500">Unit Count</span>
                          <input 
                            type="number"
                            min="1"
                            value={boothCount}
                            onChange={(e) => {
                              const val = Math.max(1, parseInt(e.target.value) || 1);
                              setBoothCount(val);
                              pushToHistory({ ...getSnapshot(), boothCount: val });
                            }}
                            className={`w-16 border rounded px-2 py-1 text-xs font-mono text-indigo-400 focus:outline-none focus:border-indigo-500/50 text-right ${theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-white border-slate-200'}`}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              const val = Math.max(1, boothCount - 1);
                              setBoothCount(val);
                              pushToHistory({ ...getSnapshot(), boothCount: val });
                            }}
                            className={`flex-1 border py-2 rounded-lg flex items-center justify-center transition-all group active:scale-95 ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-white hover:bg-slate-50 border-slate-200 shadow-sm'}`}
                          >
                            <Minus className="w-3 h-3 text-slate-400 group-hover:text-indigo-500" />
                          </button>
                          <button 
                            onClick={() => {
                              const val = boothCount + 1;
                              setBoothCount(val);
                              pushToHistory({ ...getSnapshot(), boothCount: val });
                            }}
                            className="flex-1 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 py-2 rounded-lg flex items-center justify-center transition-all text-indigo-400 active:scale-95"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div className={`h-[1px] ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-200'}`}></div>

                      <div className="space-y-3">
                        <span className="text-[10px] font-bold uppercase text-slate-500">Unit Size (W x D)</span>
                        <div className="grid grid-cols-2 gap-2">
                          {['Width', 'Depth'].map((label, i) => (
                            <div key={label} className="flex flex-col gap-1">
                              <span className="text-[8px] text-slate-600 font-bold uppercase">{label}</span>
                              <input 
                                type="number"
                                step="0.1"
                                min="0.1"
                                value={unitSize[i]}
                                onChange={(e) => {
                                  const newVal = Math.max(0.1, parseFloat(e.target.value) || 0.1);
                                  const newSize = [...unitSize] as [number, number];
                                  newSize[i] = newVal;
                                  setUnitSize(newSize);
                                  pushToHistory({ ...getSnapshot(), unitSize: newSize });
                                }}
                                className={`border rounded px-2 py-1.5 text-[10px] font-mono focus:outline-none focus:border-indigo-500/50 ${theme === 'dark' ? 'bg-black/20 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      <p className="text-[10px] text-slate-500 mt-1 text-center italic">Footprint: {(boothCount * unitSize[0]).toFixed(1)}m x {unitSize[1].toFixed(1)}m</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section className="flex flex-col gap-2 mb-6">
              <div className="flex items-center gap-2 mb-1">
                <LayoutGrid size={12} className="text-slate-500" />
                <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5 font-mono">Camera Presets</h2>
              </div>
              <div className={`grid grid-cols-3 gap-1.5 p-2 rounded-xl border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                {Object.entries(CAMERA_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => setActiveViewpoint({ id: `preset-${key}`, ...preset })}
                    className={`py-2 px-1 rounded-lg text-[9px] font-black uppercase border transition-all active:scale-95 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400 hover:bg-indigo-500/20 hover:text-indigo-400' : 'bg-white border-slate-200 text-slate-600 hover:bg-indigo-50 shadow-sm'}`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </section>

            <section className="flex flex-col">
              <button 
                onClick={() => toggleSection('viewpoints')}
                className="flex items-center justify-between w-full text-left mb-2 group"
              >
                <div className="flex items-center gap-2">
                   <Camera size={12} className="text-slate-500" />
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5 font-mono">Viewpoints & Capture</h2>
                </div>
                {expandedSections.includes('viewpoints') ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
              </button>
              
              <AnimatePresence>
                {expandedSections.includes('viewpoints') && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className={`border rounded-xl p-4 flex flex-col gap-4 mb-4 ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={triggerSnapshot}
                          className="flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
                        >
                          <Camera size={14} />
                          Snapshot
                        </button>
                        <button 
                          onClick={() => {
                            // @ts-ignore
                            if (window.getCurrentCamera) {
                              // @ts-ignore
                              const camData = window.getCurrentCamera();
                              const newVp: Viewpoint = {
                                id: `vp-${Date.now()}`,
                                name: `View ${viewpoints.length + 1}`,
                                position: [camData.pos.x, camData.pos.y, camData.pos.z],
                                target: [camData.target.x, camData.target.y, camData.target.z]
                              };
                              setViewpoints([...viewpoints, newVp]);
                              pushToHistory({ ...getSnapshot(), viewpoints: [...viewpoints, newVp] });
                            }
                          }}
                          className={`flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase transition-all shadow-lg active:scale-95 ${theme === 'dark' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20'}`}
                        >
                          <Bookmark size={14} />
                          Save View
                        </button>
                      </div>

                      <button 
                        onClick={() => setShowGuideFrame(!showGuideFrame)}
                        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all active:scale-95 text-[10px] font-black uppercase ${showGuideFrame ? 'bg-indigo-600/10 border-indigo-500/50 text-indigo-500' : (theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10' : 'bg-white border-slate-200 text-slate-500 shadow-sm hover:bg-slate-50')}`}
                      >
                        <Maximize2 size={12} strokeWidth={3} />
                        Snapshot Guide Frame {showGuideFrame ? 'ON' : 'OFF'}
                      </button>

                      <div className="space-y-2 pt-2 border-t border-white/5">
                        <div className="flex items-center justify-between pr-1">
                          <span className="text-[8px] font-black uppercase text-slate-500 tracking-widest pl-1">Saved Views</span>
                          <div className="flex items-center gap-1">
                            {viewpoints.length > 0 && (
                              <button 
                                onClick={downloadViewpoints}
                                className={`p-1.5 rounded-md transition-all text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10`}
                                title="Download Views"
                              >
                                <Download size={12} />
                              </button>
                            )}
                            <button 
                              onClick={() => viewpointsUploadRef.current?.click()}
                              className={`p-1.5 rounded-md transition-all text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10`}
                              title="Upload Views"
                            >
                              <Upload size={12} />
                            </button>
                            <input 
                              type="file" 
                              ref={viewpointsUploadRef} 
                              onChange={handleImportViewpoints} 
                              className="hidden" 
                              accept=".json" 
                            />
                          </div>
                        </div>
                        {viewpoints.length > 0 && (
                          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                            {viewpoints.map((vp) => (
                              <div key={vp.id} className={`group flex items-center justify-between p-2 rounded-lg transition-all border ${theme === 'dark' ? 'bg-black/20 border-white/5 hover:border-indigo-500/30' : 'bg-white border-slate-100 hover:border-indigo-400 shadow-sm'}`}>
                                <div className="flex items-center gap-2">
                                  <MapPin size={10} className="text-indigo-400" />
                                  <span className={`text-[10px] font-bold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>{vp.name}</span>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={() => setActiveViewpoint(vp)}
                                    className="p-1.5 rounded-md hover:bg-indigo-500 hover:text-white transition-all text-slate-400"
                                    title="Go to Viewpoint"
                                  >
                                    <Maximize2 size={12} />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      const nextVps = viewpoints.filter(v => v.id !== vp.id);
                                      setViewpoints(nextVps);
                                      pushToHistory({ ...getSnapshot(), viewpoints: nextVps });
                                    }}
                                    className="p-1.5 rounded-md hover:bg-red-500 hover:text-white transition-all text-slate-400"
                                    title="Delete Viewpoint"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section className="flex flex-col">
              <button 
                onClick={() => toggleSection('environment')}
                className="flex items-center justify-between w-full text-left mb-2 group"
              >
                <div className="flex items-center gap-2">
                   <Settings size={12} className="text-slate-500" />
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5 font-mono">Environment Settings</h2>
                </div>
                {expandedSections.includes('environment') ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
              </button>
              
              <AnimatePresence>
                {expandedSections.includes('environment') && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className={`border rounded-xl p-4 flex flex-col gap-4 mb-4 ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10 shadow-inner group">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black uppercase text-indigo-400 font-mono tracking-tighter">Shadow Mode</span>
                            <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest leading-none">Soft Contact Shadows</span>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setShadowsEnabled(!shadowsEnabled);
                              pushToHistory();
                            }}
                            className={`w-12 h-6 rounded-full relative transition-all duration-500 shadow-lg ${shadowsEnabled ? 'bg-indigo-500 ring-2 ring-indigo-500/20' : 'bg-slate-700/50'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-500 shadow-md transform ${shadowsEnabled ? 'translate-x-7 rotate-90 scale-110' : 'translate-x-1 rotate-0 scale-90'}`}>
                               {shadowsEnabled ? <Box size={8} className="text-indigo-600 m-auto mt-0.5" /> : <Box size={8} className="text-slate-400 m-auto mt-0.5 opacity-50" />}
                            </div>
                          </button>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10 shadow-inner group">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black uppercase text-indigo-400 font-mono tracking-tighter">Ground Projection</span>
                            <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest leading-none">Enable 3D Depth</span>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              const val = !groundEnabled;
                              setGroundEnabled(val);
                              setShowBackground(val);
                              pushToHistory({ ...getSnapshot(), groundEnabled: val, showBackground: val });
                            }}
                            className={`w-12 h-6 rounded-full relative transition-all duration-500 shadow-lg ${groundEnabled ? 'bg-indigo-500 ring-2 ring-indigo-500/20' : 'bg-slate-700/50'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-500 shadow-md transform ${groundEnabled ? 'translate-x-7 rotate-90 scale-110' : 'translate-x-1 rotate-0 scale-90'}`}>
                               {groundEnabled ? <Layers size={8} className="text-indigo-600 m-auto mt-0.5" /> : <Layers size={8} className="text-slate-400 m-auto mt-0.5 opacity-50" />}
                            </div>
                          </button>
                        </div>

                        <div className="flex items-center justify-between p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10 shadow-inner group">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black uppercase text-indigo-400 font-mono tracking-tighter">World Center</span>
                            <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest leading-none">Show Orientation Point</span>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              const val = !showWorldCenter;
                              setShowWorldCenter(val);
                              pushToHistory({ ...getSnapshot(), showWorldCenter: val });
                            }}
                            className={`w-12 h-6 rounded-full relative transition-all duration-500 shadow-lg ${showWorldCenter ? 'bg-indigo-500 ring-2 ring-indigo-500/20' : 'bg-slate-700/50'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-500 shadow-md transform ${showWorldCenter ? 'translate-x-7 rotate-90 scale-110' : 'translate-x-1 rotate-0 scale-90'}`}>
                               {showWorldCenter ? <Move size={8} className="text-indigo-600 m-auto mt-0.5" /> : <Move size={8} className="text-slate-400 m-auto mt-0.5 opacity-50" />}
                            </div>
                          </button>
                        </div>

                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase text-slate-500 font-mono">HDRI Source</span>
                            {customEnvUrl && (
                              <button 
                                onClick={() => { 
                                  setCustomEnvUrl(null); 
                                  setCustomEnvName(null); 
                                  deleteAssetFromDB('custom-env'); 
                                  pushToHistory({ ...getSnapshot(), customEnvUrl: null, customEnvName: null });
                                }}
                                className="text-[9px] text-red-400 font-bold hover:underline"
                              >
                                Reset
                              </button>
                            )}
                          </div>
                          {!customEnvUrl ? (
                            <select 
                              value={envPreset}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEnvPreset(val);
                                pushToHistory({ ...getSnapshot(), envPreset: val });
                              }}
                              className={`w-full border rounded-lg px-2 py-1.5 text-[10px] font-bold uppercase focus:outline-none ${theme === 'dark' ? 'bg-black/40 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-700'}`}
                            >
                              {["city", "apartment", "dawn", "forest", "lobby", "night", "park", "studio", "sunset", "warehouse"].map(p => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                          ) : (
                            <div className="text-[10px] font-bold text-indigo-400 p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20 truncate">
                              {customEnvName}
                            </div>
                          )}
                          <button 
                            onClick={() => envUploadRef.current?.click()}
                            className={`flex items-center justify-center gap-2 border border-dashed rounded-lg py-2 transition-all hover:bg-indigo-500/10 group`}
                          >
                            <Upload size={12} className="text-slate-400 group-hover:text-indigo-400" />
                            <span className="text-[10px] font-bold uppercase text-slate-500 group-hover:text-indigo-400">Upload HDR/EXR</span>
                          </button>
                          <input type="file" ref={envUploadRef} onChange={handleCustomEnvUpload} hidden accept=".hdr,.exr,image/*" />
                        </div>

                          <div className="space-y-4 pt-2 border-t border-white/5">
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold uppercase text-slate-500 font-mono group-hover:text-indigo-400 transition-colors">Env Intensity</span>
                                <div className="flex items-center gap-2">
                                  <button onClick={() => {setEnvIntensity(Math.max(0, envIntensity - 0.1)); pushToHistory();}} className="p-1 rounded bg-slate-500/10 text-slate-400 hover:text-white">-</button>
                                  <span className="text-[10px] font-mono text-indigo-400 font-bold w-8 text-center">{envIntensity.toFixed(1)}</span>
                                  <button onClick={() => {setEnvIntensity(Math.min(10, envIntensity + 0.1)); pushToHistory();}} className="p-1 rounded bg-slate-500/10 text-slate-400 hover:text-white">+</button>
                                </div>
                              </div>
                              <input 
                                type="range" min="0" max="10" step="0.1" value={envIntensity} 
                                onChange={(e) => setEnvIntensity(parseFloat(e.target.value))} 
                                onMouseUp={() => pushToHistory()}
                                className="w-full h-1.5 bg-indigo-500/10 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold uppercase text-slate-500 font-mono">Env Rotation</span>
                                <div className="flex items-center gap-2">
                                  <button onClick={() => {setEnvRotation((envRotation - 0.05 + 2) % 2); pushToHistory();}} className="p-1 rounded bg-slate-500/10 text-slate-400 hover:text-white">-</button>
                                  <span className="text-[10px] font-mono text-indigo-400 font-bold w-12 text-center">{Math.round(envRotation * 180)}°</span>
                                  <button onClick={() => {setEnvRotation((envRotation + 0.05) % 2); pushToHistory();}} className="p-1 rounded bg-slate-500/10 text-slate-400 hover:text-white">+</button>
                                </div>
                              </div>
                              <input 
                                type="range" min="0" max="2" step="0.01" value={envRotation} 
                                onChange={(e) => setEnvRotation(parseFloat(e.target.value))} 
                                onMouseUp={() => pushToHistory()}
                                className="w-full h-1.5 bg-indigo-500/10 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                              />
                            </div>

                            <div className="space-y-4 pt-2 border-t border-white/5">
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] font-bold uppercase text-slate-500 font-mono">BG Intensity</span>
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => {setBgIntensity(Math.max(0, bgIntensity - 0.1)); pushToHistory();}} className="p-1 rounded bg-slate-500/10 text-slate-400 hover:text-white">-</button>
                                    <span className="text-[10px] font-mono text-indigo-400 font-bold w-12 text-center">{bgIntensity.toFixed(1)}</span>
                                    <button onClick={() => {setBgIntensity(Math.min(5, bgIntensity + 0.1)); pushToHistory();}} className="p-1 rounded bg-slate-500/10 text-slate-400 hover:text-white">+</button>
                                  </div>
                                </div>
                                <input 
                                  type="range" min="0" max="5" step="0.1" value={bgIntensity} 
                                  onChange={(e) => setBgIntensity(parseFloat(e.target.value))} 
                                  onMouseUp={() => pushToHistory()}
                                  className="w-full h-1.5 bg-indigo-500/10 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                                />
                              </div>

                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] font-bold uppercase text-slate-500 font-mono">BG Rotation</span>
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => {setBgRotation((bgRotation - 0.05 + 2) % 2); pushToHistory();}} className="p-1 rounded bg-slate-500/10 text-slate-400 hover:text-white">-</button>
                                    <span className="text-[10px] font-mono text-indigo-400 font-bold w-12 text-center">{Math.round(bgRotation * 180)}°</span>
                                    <button onClick={() => {setBgRotation((bgRotation + 0.05) % 2); pushToHistory();}} className="p-1 rounded bg-slate-500/10 text-slate-400 hover:text-white">+</button>
                                  </div>
                                </div>
                                <input 
                                  type="range" min="0" max="2" step="0.01" value={bgRotation} 
                                  onChange={(e) => setBgRotation(parseFloat(e.target.value))} 
                                  onMouseUp={() => pushToHistory()}
                                  className="w-full h-1.5 bg-indigo-500/10 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                                />
                              </div>
                            </div>
                          </div>

                        <div className="pt-2">
                          <span className="text-[10px] font-bold uppercase text-slate-500 font-mono block mb-3">Ground Projection</span>
                          <div className="grid grid-cols-3 gap-2">
                            {['Height', 'Radius', 'Scale'].map((label) => (
                              <div key={label} className="flex flex-col gap-1">
                                <span className="text-[8px] text-slate-500 font-bold uppercase text-center">{label}</span>
                                <input 
                                  type="number"
                                  value={label === 'Height' ? envHeight : label === 'Radius' ? envRadius : envScale}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (label === 'Height') setEnvHeight(val);
                                    else if (label === 'Radius') setEnvRadius(val);
                                    else setEnvScale(val);
                                    pushToHistory();
                                  }}
                                  className={`py-1 text-center font-mono text-[10px] rounded border w-full focus:outline-none focus:border-indigo-500/50 ${theme === 'dark' ? 'bg-black/20 border-white/5 text-white' : 'bg-white border-slate-200 text-slate-900 shadow-inner'}`}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section className="flex flex-col">
              <button 
                onClick={() => toggleSection('base')}
                className="flex items-center justify-between w-full text-left mb-2 group"
              >
                <div className="flex items-center gap-2">
                   <Box size={12} className="text-slate-500" />
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Base Stocks</h2>
                </div>
                {expandedSections.includes('base') ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
              </button>
              
              <AnimatePresence>
                {expandedSections.includes('base') && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {baseStocks.map(stock => (
                        <div key={stock.id} className="relative group">
                          <button 
                            onClick={() => {
                              const isSelected = selectedBoothStockIds.includes(stock.id);
                              if (isSelected) {
                                setSelectedBoothStockIds(prev => prev.filter(id => id !== stock.id));
                              } else {
                                setSelectedBoothStockIds(prev => [...prev, stock.id]);
                              }
                              setSelectedId(BOOTH_BASE_ID);
                              pushToHistory();
                            }}
                            className={`w-full flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${selectedBoothStockIds.includes(stock.id) ? 'bg-indigo-500/10 border-indigo-500/50' : (theme === 'dark' ? 'bg-white/5 border-transparent hover:bg-white/10' : 'bg-slate-100 border-transparent hover:bg-slate-200')}`}
                          >
                            {stock.thumbnailUrl ? (
                              <img src={stock.thumbnailUrl} alt={stock.name} className="w-10 h-10 object-contain mb-1 rounded bg-black/10" referrerPolicy="no-referrer" />
                            ) : (
                              <Box className={`w-3 h-3 mb-1 ${selectedBoothStockIds.includes(stock.id) ? 'text-indigo-400' : 'text-slate-500'}`} />
                            )}
                            <span className={`text-[9px] font-bold truncate w-full px-1 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>{stock.name}</span>
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); removeBaseStock(stock.id); }}
                            className="absolute -top-1 -right-1 p-1 bg-red-500 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                          >
                            <Trash2 className="w-2 h-2" />
                          </button>
                        </div>
                      ))}
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className={`flex flex-col items-center justify-center p-2 border-2 border-dashed rounded-lg transition-all hover:bg-indigo-500/10 ${theme === 'dark' ? 'border-white/5 text-slate-500' : 'border-slate-200 text-slate-400'}`}
                      >
                        <Plus size={16} />
                        <span className="text-[8px] font-bold uppercase mt-1">Upload GLB</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section className="flex flex-col flex-1 min-h-0">
              <button 
                onClick={() => toggleSection('explorer')}
                className="flex items-center justify-between w-full text-left mb-2 group"
              >
                <div className="flex items-center gap-2">
                   <Layers size={12} className="text-slate-500" />
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Scene Explorer</h2>
                </div>
                {expandedSections.includes('explorer') ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
              </button>
              
              <AnimatePresence>
                {expandedSections.includes('explorer') && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="flex flex-col overflow-hidden"
                  >
                    <div className="space-y-1 mb-4 overflow-y-auto max-h-60 pr-2 custom-scrollbar">
                      {/* Booth Base Layers - Multiple Structures */}
                      {boothModelUrls.map((url, idx) => {
                        const stock = baseStocks.find(s => s.url === url);
                        const name = stock ? stock.name : `Structure Module ${idx + 1}`;
                        const isSelected = selectedId === BOOTH_BASE_ID; // Highlight if layout is selected

                        return (
                          <div 
                            key={`booth-struct-${idx}`}
                            className="group relative"
                          >
                            <button 
                              onClick={() => setSelectedId(BOOTH_BASE_ID)}
                              className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all border ${isSelected ? 'bg-indigo-500/10 border-indigo-500/50' : (theme === 'dark' ? 'bg-white/5 border-transparent hover:bg-white/10' : 'bg-slate-100 border-transparent hover:bg-slate-200 shadow-sm')}`}
                            >
                              <Layout className={`w-4 h-4 ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`} />
                              <div className="flex flex-col flex-1 overflow-hidden">
                                <span className={`text-[10px] font-black uppercase truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{name}</span>
                                <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">{boothCount} Segments Active</span>
                              </div>
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                const nextIds = selectedBoothStockIds.filter((_, i) => i !== idx);
                                setSelectedBoothStockIds(nextIds);
                                pushToHistory({ ...getSnapshot(), selectedBoothStockIds: nextIds });
                                if (nextIds.length === 0) setSelectedId(null);
                              }}
                              className="absolute top-1/2 -translate-y-1/2 right-2 p-1.5 rounded-md text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Remove Module"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        );
                      })}

                      {boothModelUrls.length === 0 && (
                        <button 
                          onClick={() => setSelectedId(BOOTH_BASE_ID)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all border ${selectedId === BOOTH_BASE_ID ? 'bg-indigo-500/10 border-indigo-500/50' : (theme === 'dark' ? 'bg-white/5 border-transparent hover:bg-white/10' : 'bg-slate-100 border-transparent hover:bg-slate-200 shadow-sm')}`}
                        >
                          <Layout className={`w-4 h-4 ${selectedId === BOOTH_BASE_ID ? 'text-indigo-400' : 'text-slate-500'}`} />
                          <div className="flex flex-col">
                            <span className={`text-xs font-bold truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Empty Structure</span>
                            <span className="text-[9px] text-slate-500 uppercase">Click to Configure Layout</span>
                          </div>
                        </button>
                      )}

                      {/* Furniture Layers */}
                      {furniture.map((item) => (
                        <button 
                          key={item.id}
                          onClick={() => setSelectedId(item.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all border ${selectedId === item.id ? 'bg-indigo-500/10 border-indigo-500/50' : (theme === 'dark' ? 'bg-white/5 border-transparent hover:bg-white/10' : 'bg-slate-100 border-transparent hover:bg-slate-200 shadow-sm')}`}
                        >
                          {item.type === 'Plane' ? <Info className="w-4 h-4 text-slate-500" /> : <Box className="w-4 h-4 text-slate-500" />}
                          <div className="flex flex-col">
                            <span className={`text-xs font-bold truncate capitalize ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{item.type} Object</span>
                            <span className="text-[9px] text-slate-500 uppercase italic">ID: {item.id.slice(0, 4)}</span>
                          </div>
                        </button>
                      ))}

                      {furniture.length === 0 && (
                        <div className="py-6 text-center border border-dashed rounded-lg border-white/5">
                          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">No assets added</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>

          <div className={`p-6 mt-auto border-t ${theme === 'dark' ? 'bg-indigo-900/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'}`}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
              <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-500">Workspace Hub</span>
            </div>
            <p className={`text-[10px] leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Modules auto-align to grid. Selection enabled for individual transformation.</p>
          </div>
          
          <input type="file" ref={fileInputRef} onChange={handleBoothUpload} accept=".glb,.gltf" className="hidden" />
        </motion.aside>

        {/* Main Viewport: 3D Scene Simulation */}
        <main className={`flex-1 relative transition-colors duration-300 ${theme === 'dark' ? 'bg-[#07080A]' : 'bg-slate-200'}`}>
          <SnapshotGuide show={showGuideFrame} />
          <Canvas shadows gl={{ antialias: true, preserveDrawingBuffer: true }}>
            {isLoaded && (
              <Suspense fallback={<Html center><div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-slate-400 text-xs font-bold uppercase tracking-widest">Initializing Engine</div>
              </div></Html>}>
                <ErrorBoundary>
                  <Scene 
                  boothCount={boothCount} 
                  baseUnitSize={unitSize}
                  boothModelUrls={boothModelUrls} 
                  boothPosition={boothPosition}
                  boothRotation={boothRotation}
                  boothLocked={boothLocked}
                  furniture={furniture}
                  selectedId={selectedId}
                  setSelectedId={setSelectedId}
                  onUpdatePosition={setPositionFromGizmo}
                  onUpdateRotation={setRotationFromGizmo}
                  theme={theme}
                  envPreset={envPreset}
                  envIntensity={envIntensity}
                  envRotation={envRotation}
                  shadowsEnabled={shadowsEnabled}
                  bgIntensity={bgIntensity}
                  bgRotation={bgRotation}
                  envHeight={envHeight}
                  envRadius={envRadius}
                  envScale={envScale}
                  customEnvUrl={customEnvUrl}
                  showBackground={showBackground}
                  groundEnabled={groundEnabled}
                  showWorldCenter={showWorldCenter}
                  viewpointTrigger={viewpointTrigger}
                  setViewpointTrigger={setViewpointTrigger}
                  isSnapshotting={isSnapshotting}
                  onSnapshotComplete={onSnapshotComplete}
                  activeViewpoint={activeViewpoint}
                  setActiveViewpoint={setActiveViewpoint}
                  viewMode={viewMode}
                  cameraView={cameraView}
                  gizmoMode={gizmoMode}
                  exportRef={exportRef}
                  thumbnailTrigger={thumbnailTrigger}
                  onThumbnailCapture={onThumbnailCapture}
                />
              </ErrorBoundary>
            </Suspense>
          )}
          </Canvas>

          {/* Floating UI HUD Labels (Telemetery) */}
          <div className="absolute top-10 left-10 pointer-events-none text-white/30 font-mono text-[10px] flex flex-col gap-1 z-10 transition-opacity duration-500">
            <span className={`${theme === 'dark' ? 'text-white/30' : 'text-slate-900/30'}`}>BOOTH_SEGMENTS: {boothCount}</span>
            <span className={`${theme === 'dark' ? 'text-white/30' : 'text-slate-900/30'}`}>FOOTPRINT: {boothCount * 2}m x 2m</span>
            {selectedItem && (
              <>
                <div className="h-4"></div>
                <span className="text-indigo-400 font-bold uppercase tracking-tighter">Selection Active: {selectedItem.type}</span>
                <span className={`${theme === 'dark' ? 'text-white/20' : 'text-slate-900/20'}`}>POS: {selectedItem.position[0].toFixed(2)}, {selectedItem.position[1].toFixed(2)}, {selectedItem.position[2].toFixed(2)}</span>
                <span className={`${theme === 'dark' ? 'text-white/20' : 'text-slate-900/20'}`}>ROT: {((selectedItem.rotation[0] * 180) / Math.PI).toFixed(0)}°, {((selectedItem.rotation[1] * 180) / Math.PI).toFixed(0)}°, {((selectedItem.rotation[2] * 180) / Math.PI).toFixed(0)}°</span>
              </>
            )}
          </div>

          {/* Interaction HUD */}
          <div className="absolute top-8 right-8 flex flex-col gap-3 z-10 transition-all">
            <div className={`p-1 rounded-xl backdrop-blur-md border shadow-xl flex flex-col gap-1 transition-all ${theme === 'dark' ? 'bg-black/40 border-white/10' : 'bg-white/60 border-slate-200'}`}>
              <button 
                onClick={() => {
                  const nextMode = viewMode === '3D' ? '2D' : '3D';
                  setViewMode(nextMode);
                  if (nextMode === '2D') setCameraView('top');
                  else setCameraView('perspective');
                }}
                className={`px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 group active:scale-95 ${viewMode === '2D' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/40' : (theme === 'dark' ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-600 hover:bg-slate-100')}`}
              >
                {viewMode === '3D' ? <Box size={14} className="group-hover:rotate-12 transition-transform" /> : <Layers size={14} className="group-hover:-rotate-12 transition-transform" />}
                {viewMode === '3D' ? 'Switch to 2D' : 'Switch to 3D'}
              </button>
            </div>

            {viewMode === '2D' && (
              <div className={`p-1.5 rounded-xl backdrop-blur-md border shadow-xl flex flex-col gap-1 transition-all ${theme === 'dark' ? 'bg-black/40 border-white/10' : 'bg-white/60 border-slate-200'}`}>
                <div className="px-3 py-1.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5 mb-1 flex items-center gap-2">
                  <Camera size={10} /> Camera Preset
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    { id: 'perspective', label: 'Perspective', icon: <Box size={10} /> },
                    { id: 'top', label: 'Top', icon: <ChevronUp size={10} /> },
                    { id: 'front', label: 'Front', icon: <ChevronDown size={10} /> },
                    { id: 'back', label: 'Back', icon: <ChevronUp size={10} className="rotate-180" /> },
                    { id: 'left', label: 'Left', icon: <ChevronLeft size={10} /> },
                    { id: 'right', label: 'Right', icon: <ChevronRight size={10} /> }
                  ].map((v) => (
                    <button 
                      key={v.id}
                      onClick={() => {
                        setCameraView(v.id as any);
                      }}
                      className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-tighter transition-all flex items-center gap-2 active:scale-95 ${cameraView === v.id ? 'bg-indigo-500 text-white shadow-md' : (theme === 'dark' ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-600 hover:bg-slate-100')}`}
                    >
                      {v.icon}
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 backdrop-blur-md px-6 py-3 rounded-2xl border shadow-2xl z-10 transition-all ${theme === 'dark' ? 'bg-black/60 border-white/10 hover:bg-black/80' : 'bg-white/80 border-slate-200 hover:bg-white shadow-slate-200'}`}>
            <button 
              onClick={() => setGizmoMode('translate')}
              className="flex flex-col items-center gap-1 group"
            >
              <div className={`p-2 rounded-lg transition-all ${gizmoMode === 'translate' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/50' : (theme === 'dark' ? 'bg-white/5 group-hover:bg-white/20 text-slate-400' : 'bg-slate-100 group-hover:bg-slate-200 text-slate-500')}`}>
                <Move className="w-5 h-5" />
              </div>
              <span className={`text-[9px] uppercase font-bold tracking-widest ${gizmoMode === 'translate' ? 'text-indigo-400' : 'text-slate-500'}`}>Move</span>
            </button>
            <div className={`w-[1px] h-8 ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`}></div>
            <button 
              onClick={() => setGizmoMode('rotate')}
              className="flex flex-col items-center gap-1 group"
            >
              <div className={`p-2 rounded-lg transition-all ${gizmoMode === 'rotate' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/50' : (theme === 'dark' ? 'bg-white/5 group-hover:bg-white/20 text-slate-400' : 'bg-slate-100 group-hover:bg-slate-200 text-slate-500')}`}>
                <Plus className="w-5 h-5 rotate-45" /> 
              </div>
              <span className={`text-[9px] uppercase font-bold tracking-widest ${gizmoMode === 'rotate' ? 'text-indigo-400' : 'text-slate-500'}`}>Rotate</span>
            </button>
          </div>
        </main>

        {/* Right Panel: Furniture Library & Selection */}
        <motion.aside 
          initial={false}
          animate={{ width: rightSidebarOpen ? 320 : 0, opacity: rightSidebarOpen ? 1 : 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className={`border-l flex flex-col z-20 transition-colors duration-300 overflow-hidden ${theme === 'dark' ? 'bg-[#0F1116] border-white/10 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`}
        >
          <div className="w-80 h-full flex flex-col">
            <div className="flex-1 p-6 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col gap-8">
              <section className="flex flex-col">
                <button 
                  onClick={() => toggleSection('library')}
                  className="flex items-center justify-between w-full text-left mb-4 group"
                >
                  <div className="flex items-center gap-2">
                     <Layout size={12} className="text-slate-500" />
                     <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Object Library</h2>
                  </div>
                  {expandedSections.includes('library') ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
                </button>

                <AnimatePresence>
                  {expandedSections.includes('library') && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-2 gap-3 mb-2">
                        <div 
                          onClick={() => addFurniture('','Box')}
                          className={`border rounded-xl p-3 cursor-pointer group transition-all ${theme === 'dark' ? 'bg-white/5 border-white/10 hover:border-indigo-500/50 shadow-none' : 'bg-slate-50 border-slate-200 hover:border-indigo-500/50 shadow-sm'}`}
                        >
                          <div className="h-16 bg-gradient-to-br from-indigo-500/20 to-transparent rounded-lg mb-2 flex items-center justify-center">
                            <div className="w-6 h-6 bg-slate-500/40 rounded shadow-inner flex items-center justify-center">
                              <Box className="w-3 h-3 text-white/50" />
                            </div>
                          </div>
                          <div className={`text-[10px] font-bold uppercase mb-0.5 text-center ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Basic Box</div>
                        </div>

                        <div 
                          onClick={() => addFurniture('', 'Plane')}
                          className={`border rounded-xl p-3 cursor-pointer group transition-all ${theme === 'dark' ? 'bg-white/5 border-white/10 hover:border-indigo-500/50 shadow-none' : 'bg-slate-50 border-slate-200 hover:border-indigo-500/50 shadow-sm'}`}
                        >
                          <div className="h-16 bg-gradient-to-br from-indigo-500/20 to-transparent rounded-lg mb-2 flex items-center justify-center">
                            <div className="w-8 h-8 border-2 border-slate-500/40 rounded shadow-inner flex items-center justify-center">
                              <span className="text-[8px] font-bold text-slate-500">PLANE</span>
                            </div>
                          </div>
                          <div className={`text-[10px] font-bold uppercase mb-0.5 text-center ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Plane Panel</div>
                        </div>

                        <div 
                          onClick={() => furnitureInputRef.current?.click()}
                          className={`col-span-2 border border-dashed rounded-xl py-4 cursor-pointer group transition-all flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-indigo-500/5 border-indigo-500/20 text-indigo-400/60 hover:bg-indigo-500/10 hover:text-indigo-400' : 'bg-indigo-50 border-indigo-100 text-indigo-500/70 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm shadow-indigo-100/50'}`}
                        >
                          <Upload className="w-4 h-4 mb-1" />
                          <span className="text-[9px] font-black uppercase tracking-widest">Add Custom .GLB</span>
                          <input 
                            type="file" 
                            ref={furnitureInputRef} 
                            onChange={handleFurnitureUpload} 
                            accept=".glb,.gltf" 
                            className="hidden" 
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              <section className="flex flex-col">
                <button 
                  onClick={() => toggleSection('stock')}
                  className="flex items-center justify-between w-full text-left mb-4 group"
                >
                  <div className="flex items-center gap-2">
                     <Layers size={12} className="text-slate-500" />
                     <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Stock Assets</h2>
                  </div>
                  {expandedSections.includes('stock') ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
                </button>

                <AnimatePresence>
                  {expandedSections.includes('stock') && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-2 gap-2">
                        {assetStocks.map(stock => (
                          <div key={stock.id} className="relative group">
                            <button 
                              onClick={() => addFurniture(stock.url, 'Custom', undefined, stock.id)}
                              className={`w-full flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${theme === 'dark' ? 'border-white/5 bg-white/5 hover:bg-white/10 hover:border-indigo-500/30' : 'bg-slate-50 border-slate-200 hover:bg-white hover:border-indigo-500/30 shadow-sm'}`}
                            >
                              {stock.thumbnailUrl ? (
                                <img src={stock.thumbnailUrl} alt={stock.name} className="w-16 h-16 object-contain mb-2 rounded bg-black/10" referrerPolicy="no-referrer" />
                              ) : (
                                <Box className="w-4 h-4 mb-2 text-slate-500 group-hover:text-indigo-400" />
                              )}
                              <span className={`text-[9px] font-bold truncate w-full px-1 ${theme === 'dark' ? 'text-slate-400 group-hover:text-white' : 'text-slate-600 group-hover:text-slate-900'}`}>{stock.name}</span>
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); removeAssetStock(stock.id); }}
                              className="absolute -top-1 -right-1 p-1 bg-red-500 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                            >
                              <Trash2 className="w-2 h-2" />
                            </button>
                          </div>
                        ))}
                        {assetStocks.length === 0 && (
                          <div className={`col-span-2 py-8 border border-dashed rounded-xl text-center ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'}`}>
                            <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest text-center mx-auto">No models uploaded yet</p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              <section className="flex flex-col">
                <button 
                  onClick={() => toggleSection('selection')}
                  disabled={!selectedId}
                  className={`flex items-center justify-between w-full text-left mb-4 group transition-opacity ${!selectedId ? 'opacity-30 cursor-not-allowed' : 'opacity-100'}`}
                >
                  <div className="flex items-center gap-2">
                     <Layout size={12} className="text-indigo-500" />
                     <h2 className="text-[11px] font-black text-indigo-500 uppercase tracking-widest mt-0.5">Panel Controls</h2>
                  </div>
                  {expandedSections.includes('selection') ? <ChevronUp size={12} className="text-indigo-500" /> : <ChevronDown size={12} className="text-indigo-500" />}
                </button>

                <AnimatePresence>
                  {selectedId && selectedItem && expandedSections.includes('selection') && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className={`space-y-6 overflow-hidden`}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold uppercase text-slate-500">Active Selection</span>
                          <span className={`text-xs font-black uppercase truncate max-w-[150px] ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{selectedItem.type}</span>
                        </div>
                        <button 
                          onClick={toggleLockSelected}
                          className={`p-2 rounded-lg border transition-all flex items-center gap-2 ${(selectedId === BOOTH_BASE_ID ? boothLocked : selectedItem.locked) ? 'bg-red-500/20 border-red-500/50 text-red-500 shadow-lg shadow-red-500/10' : (theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-slate-50 border-slate-200 text-slate-600')}`}
                          title={(selectedId === BOOTH_BASE_ID ? boothLocked : selectedItem.locked) ? "Unlock Object" : "Lock Object"}
                        >
                          {(selectedId === BOOTH_BASE_ID ? boothLocked : selectedItem.locked) ? <Lock size={14} /> : <Unlock size={14} />}
                          <span className="text-[10px] font-black uppercase">{(selectedId === BOOTH_BASE_ID ? boothLocked : selectedItem.locked) ? 'Locked' : 'Lock'}</span>
                        </button>
                      </div>

                      <div className="space-y-6">
                        {/* Appearance settings */}
                        {selectedItem.type !== 'Custom' && selectedItem.type !== 'Structural Base' && (
                          <div className="flex flex-col gap-3">
                            <header className="flex justify-between items-center">
                               <label className="text-[9px] text-slate-500 uppercase font-bold">Appearance</label>
                               {selectedItem.type === 'Plane' && (
                                  <button 
                                    onClick={() => planeInputRef.current?.click()}
                                    className="text-[9px] text-indigo-400 font-bold hover:underline"
                                  >
                                    Upload Image
                                  </button>
                               )}
                               <input 
                                type="file" 
                                ref={planeInputRef} 
                                onChange={handlePlaneImageUpload} 
                                accept="image/*" 
                                className="hidden" 
                               />
                            </header>
                            
                            <div className="flex flex-col gap-3">
                              <div className="flex flex-wrap gap-2">
                                {["#ffffff", "#ef4444", "#22c55e", "#3b82f6", "#eab308", "#a855f7", "#000000"].map((c) => (
                                  <button
                                    key={c}
                                    onClick={() => updateFurnitureColor(c)}
                                    className={`w-6 h-6 rounded-lg border transition-all hover:scale-110 active:scale-95 ${(selectedItem as Furniture).color === c ? 'border-indigo-500 ring-2 ring-indigo-500/50 scale-110' : (theme === 'dark' ? 'border-white/10' : 'border-slate-200 shadow-sm')}`}
                                    style={{ backgroundColor: c }}
                                    title={c}
                                  />
                                ))}
                                
                                {/* Custom Color Picker */}
                                <div className="relative group">
                                  <input 
                                    type="color" 
                                    id="furniture-color-picker"
                                    value={(selectedItem as Furniture).color || "#ffffff"}
                                    onChange={(e) => updateFurnitureColor(e.target.value)}
                                    className="absolute inset-0 opacity-0 w-6 h-6 cursor-pointer"
                                  />
                                  <div className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-all group-hover:scale-110 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
                                    <Pipette size={12} />
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border ${theme === 'dark' ? 'bg-black/20 border-white/5' : 'bg-white border-slate-200 shadow-inner'}`}>
                                  <span className="text-[10px] font-mono text-slate-500 uppercase">HEX</span>
                                  <input 
                                    type="text"
                                    spellCheck={false}
                                    value={(selectedItem as Furniture).color || "#ffffff"}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (/^#?([0-9a-fA-F]{3,6})$/.test(val)) {
                                        updateFurnitureColor(val.startsWith('#') ? val : `#${val}`);
                                      }
                                    }}
                                    className="flex-1 bg-transparent text-[10px] font-mono focus:outline-none text-right uppercase"
                                    placeholder="#FFFFFF"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {selectedItem.type === 'Plane' && (
                          <div className="flex flex-col gap-3">
                            <label className="text-[9px] text-slate-500 uppercase font-bold">Panel Dimensions (m)</label>
                            <div className="grid grid-cols-2 gap-2">
                               {['W', 'H'].map((dim, i) => (
                                  <div key={dim} className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between px-1">
                                      <span className="text-[8px] font-bold text-slate-400 uppercase">{dim === 'W' ? 'Width' : 'Height'}</span>
                                      <span className="text-[10px] font-mono text-indigo-400">{(selectedItem.size?.[i] || 1).toFixed(1)}</span>
                                    </div>
                                    <input 
                                      type="number"
                                      step="0.1"
                                      disabled={selectedItem.locked}
                                      value={selectedItem.size?.[i] || 1}
                                      onChange={(e) => updatePlaneSizeValue(parseFloat(e.target.value) || 0, i === 0)}
                                      className={`py-1 text-center font-mono text-[10px] rounded border w-full focus:outline-none focus:border-indigo-500/50 mb-1 ${selectedItem.locked ? 'opacity-40 cursor-not-allowed' : ''} ${theme === 'dark' ? 'bg-black/20 border-white/5 text-white' : 'bg-white border-slate-200 text-slate-900 shadow-inner'}`}
                                    />
                                    <div className="flex items-center gap-1">
                                      <button 
                                        disabled={selectedItem.locked}
                                        onClick={() => updatePlaneSize(-0.1, i === 0)}
                                        className={`flex-1 border py-1.5 rounded flex items-center justify-center transition-all ${selectedItem.locked ? 'opacity-30 cursor-not-allowed' : (theme === 'dark' ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 shadow-sm')}`}
                                      >
                                        <Minus className="w-3 h-3 opacity-50" />
                                      </button>
                                      <button 
                                        disabled={selectedItem.locked}
                                        onClick={() => updatePlaneSize(0.1, i === 0)}
                                        className={`flex-1 border py-1.5 rounded flex items-center justify-center transition-all ${selectedItem.locked ? 'opacity-30 cursor-not-allowed' : (theme === 'dark' ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 shadow-sm')}`}
                                      >
                                        <Plus className="w-3 h-3 opacity-50" />
                                      </button>
                                    </div>
                                  </div>
                               ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="text-[9px] text-slate-500 uppercase font-bold block mb-3">Translation Precision</label>
                          <div className="grid grid-cols-3 gap-2">
                            {['X', 'Y', 'Z'].map((axis, i) => (
                              <div key={axis} className="flex flex-col gap-1">
                                <span className={`text-[8px] font-bold text-center uppercase ${axis === 'X' ? 'text-red-400' : axis === 'Y' ? 'text-green-400' : 'text-blue-400'}`}>{axis} Axis</span>
                                <input 
                                  type="number"
                                  step="0.1"
                                  disabled={selectedItem.locked}
                                  value={selectedItem.position[i].toFixed(1)}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    const newPos = [...selectedItem.position] as [number, number, number];
                                    newPos[i] = val;
                                    setPositionFromGizmo(selectedId, newPos);
                                  }}
                                  className={`py-1.5 text-center font-mono text-[10px] rounded border w-full focus:outline-none focus:border-indigo-500/50 ${selectedItem.locked ? 'opacity-40 cursor-not-allowed' : ''} ${theme === 'dark' ? 'bg-black/20 border-white/5 text-white' : 'bg-white border-slate-200 text-slate-900 shadow-inner'}`}
                                />
                                <div className="flex gap-1">
                                  <button 
                                    disabled={selectedItem.locked}
                                    onClick={() => updatePosition(axis.toLowerCase() as 'x'|'y'|'z', -0.1)} 
                                    className={`flex-1 py-1 rounded transition-all active:scale-90 flex items-center justify-center border ${selectedItem.locked ? 'opacity-30 cursor-not-allowed' : 'bg-slate-500/10 hover:bg-slate-500/20 text-slate-400 border-white/5'}`}
                                  >-</button>
                                  <button 
                                    disabled={selectedItem.locked}
                                    onClick={() => updatePosition(axis.toLowerCase() as 'x'|'y'|'z', 0.1)} 
                                    className={`flex-1 py-1 rounded transition-all active:scale-90 flex items-center justify-center border ${selectedItem.locked ? 'opacity-30 cursor-not-allowed' : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border-indigo-500/10'}`}
                                  >+</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="text-[9px] text-slate-500 uppercase font-bold block mb-3">Rotation Steps (15°)</label>
                          <div className="grid grid-cols-3 gap-2">
                            {['X', 'Y', 'Z'].map((axis, i) => (
                              <div key={axis} className="flex flex-col gap-1">
                                <span className="text-[8px] font-bold text-center uppercase text-slate-500">{axis}-Rot</span>
                                <div className="relative group/field">
                                  <input 
                                    type="number"
                                    disabled={selectedItem.locked}
                                    value={Math.round((selectedItem.rotation[i] * 180) / Math.PI)}
                                    onChange={(e) => {
                                      const deg = parseFloat(e.target.value) || 0;
                                      const rad = (deg * Math.PI) / 180;
                                      const newRot = [...selectedItem.rotation] as [number, number, number];
                                      newRot[i] = rad;
                                      setRotationFromGizmo(selectedId, newRot);
                                    }}
                                    className={`py-1.5 text-center font-mono text-[10px] rounded border w-full focus:outline-none focus:border-indigo-500/50 ${selectedItem.locked ? 'opacity-40 cursor-not-allowed' : ''} ${theme === 'dark' ? 'bg-black/20 border-white/5 text-white' : 'bg-white border-slate-200 text-slate-900 shadow-inner'}`}
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <button 
                                    disabled={selectedItem.locked}
                                    onClick={() => rotateSelected(axis.toLowerCase() as 'x'|'y'|'z', -Math.PI / 12)}
                                    className={`flex-1 py-1 rounded transition-all flex items-center justify-center ${selectedItem.locked ? 'opacity-30 cursor-not-allowed bg-slate-500/5' : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'}`}
                                  >
                                    <ChevronDown size={12} className="mx-auto" />
                                  </button>
                                  <button 
                                    disabled={selectedItem.locked}
                                    onClick={() => rotateSelected(axis.toLowerCase() as 'x'|'y'|'z', Math.PI / 12)}
                                    className={`flex-1 py-1 rounded transition-all flex items-center justify-center ${selectedItem.locked ? 'opacity-30 cursor-not-allowed bg-slate-500/5' : 'bg-green-500/10 hover:bg-green-500/20 text-green-400'}`}
                                  >
                                    <ChevronUp size={12} className="mx-auto" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-8">
                        {selectedId !== BOOTH_BASE_ID && (
                          <button 
                            onClick={duplicateFurniture}
                            className={`flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase transition-all shadow-sm ${theme === 'dark' ? 'bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-400' : 'bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-600'}`}
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Clone
                          </button>
                        )}
                        <button 
                          onClick={() => removeFurniture(selectedId)}
                          className={`flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase transition-all shadow-sm ${selectedId === BOOTH_BASE_ID ? 'col-span-2' : ''} ${theme === 'dark' ? 'bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400' : 'bg-red-50 hover:bg-red-100 border border-red-100 text-red-600'}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            </div>

            <div className={`mt-auto border-t p-6 transition-colors duration-300 ${theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-slate-50 border-slate-200 shadow-inner'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div>
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 underline decoration-indigo-500/30 decoration-2 underline-offset-2">Hardware Telemetry</span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center group">
                  <span className="text-[9px] text-slate-500 font-bold uppercase transition-colors group-hover:text-indigo-400">Project Nodes</span>
                  <span className="font-mono text-indigo-400 text-[10px] bg-indigo-500/10 px-1.5 rounded">{furniture.length + 1}</span>
                </div>
                <div className="flex justify-between items-center group">
                  <span className="text-[9px] text-slate-500 font-bold uppercase transition-colors group-hover:text-indigo-400">History Buffer</span>
                  <div className="flex items-center gap-1.5">
                     <span className="font-mono text-indigo-400 text-[10px]">{historyIndex + 1}</span>
                     <span className="text-[8px] text-slate-600">/</span>
                     <span className="text-[8px] text-slate-600">{history.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.aside>
      </div>

      {/* Bottom Status Bar */}
      <footer className={`h-8 transition-colors duration-300 px-4 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-white z-30 shadow-[0_-10px_20px_rgba(0,0,0,0.1)] ${theme === 'dark' ? 'bg-indigo-600' : 'bg-indigo-500'}`}>
        <div className="flex gap-6 items-center">
           <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
              <span>Renderer: WebGL 2.0</span>
           </div>
           <span>FPS: 60</span>
        </div>
        <div className="flex gap-4 items-center">
           <span className="opacity-70">Grid: 1.0m Snap</span>
           <span className="opacity-70">Scale: 1:1</span>
           <span className="bg-white/10 px-2 py-0.5 rounded">Session Optimized</span>
        </div>
      </footer>

      {/* Custom Reset Confirmation Modal */}
      <AnimatePresence>
        {isResetModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className={`max-w-md w-full rounded-2xl p-8 border shadow-2xl ${theme === 'dark' ? 'bg-[#161922] border-white/10 shadow-black/50' : 'bg-white border-slate-200 shadow-slate-200/50'}`}
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                  <RotateCcw className="text-red-500" size={24} />
                </div>
                <div>
                  <h3 className={`text-lg font-black uppercase ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Clean Project?</h3>
                  <p className="text-xs text-slate-500 font-medium">This will permanently delete all placed objects and reset all settings. This action cannot be undone.</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setIsResetModalOpen(false)}
                  className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${theme === 'dark' ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  No, Cancel
                </button>
                <button 
                  onClick={confirmReset}
                  className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase shadow-lg shadow-red-600/20 transition-all active:scale-95"
                >
                  Yes, Clean All
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Entry / Project Selection Modal */}
      <AnimatePresence>
        {showEntryModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className={`max-w-4xl w-full rounded-2xl p-8 border shadow-2xl flex flex-col md:flex-row gap-8 overflow-hidden ${theme === 'dark' ? 'bg-[#161922] border-white/10 shadow-black/50' : 'bg-white border-slate-200 shadow-slate-200/50'}`}
            >
              {/* Left Column: Welcome & New Project */}
              <div className="flex-1 flex flex-col">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                    <Box className="text-white" size={20} />
                  </div>
                  <div>
                    <h1 className={`text-xl font-black uppercase tracking-tighter ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Booth Builder <span className="text-indigo-500">Pro</span></h1>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">3D Event Space Architect</p>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Create New Project</h2>
                    {currentProjectId && (
                      <button 
                        onClick={() => setShowEntryModal(false)}
                        className={`text-[10px] font-bold uppercase px-3 py-1 rounded-lg transition-all ${theme === 'dark' ? 'bg-white/5 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-900'}`}
                      >
                        Back to Workspace
                      </button>
                    )}
                  </div>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-black uppercase text-slate-500 pl-1">Project Name</label>
                      <input 
                        type="text"
                        placeholder="Ex: Expo 2026 Booth Design"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        className={`w-full p-4 rounded-xl border text-sm font-bold focus:outline-none focus:border-indigo-500 transition-all ${theme === 'dark' ? 'bg-black/40 border-white/10 text-white placeholder:text-slate-700' : 'bg-slate-50 border-slate-200 text-slate-900 shadow-inner placeholder:text-slate-400'}`}
                      />
                    </div>
                    <button 
                      onClick={() => createNewProject(newProjectName || 'Untitled Project')}
                      className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Plus size={16} />
                      Start Developing
                    </button>
                    <p className="text-[10px] text-slate-500 text-center px-4">Begin a fresh canvas with standard structural modules and empty event space.</p>
                  </div>
                </div>
              </div>

              {/* Right Column: Existing Projects */}
              <div className={`flex-1 flex flex-col rounded-xl p-6 border ${theme === 'dark' ? 'bg-black/20 border-white/5' : 'bg-slate-50 border-slate-200 shadow-inner'}`}>
                <div className="flex items-center justify-between mb-6">
                  <h3 className={`text-xs font-black uppercase tracking-widest ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Recent Projects</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-bold">{projects.length} Saved</span>
                </div>

                {projects.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50">
                    <div className="w-16 h-16 rounded-full border-2 border-dashed border-slate-500 flex items-center justify-center mb-4">
                      <Layout size={24} className="text-slate-500" />
                    </div>
                    <p className="text-xs font-bold text-slate-500">No projects found</p>
                    <p className="text-[10px] text-slate-600">Your designs will appear here once saved.</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3 max-h-[400px]">
                    {projects.map((proj) => (
                      <div 
                        key={proj.id}
                        className={`group p-4 rounded-xl border transition-all flex items-center gap-4 justify-between ${theme === 'dark' ? (currentProjectId === proj.id ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-[#1a1d26] border-white/5 hover:border-indigo-500/50') : (currentProjectId === proj.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 hover:border-indigo-400 shadow-sm')}`}
                      >
                         <div className="flex items-center gap-4 flex-1 overflow-hidden">
                           <div className={`w-20 h-12 rounded-lg overflow-hidden border bg-black/20 flex-shrink-0 ${theme === 'dark' ? 'border-white/10' : 'border-slate-100'}`}>
                              {proj.thumbnail ? (
                                <img src={proj.thumbnail} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-500">
                                  <Layout size={14} />
                                </div>
                              )}
                           </div>
                           
                           <div className="flex-1 flex flex-col items-start text-left overflow-hidden">
                           <div className="flex items-center gap-2 w-full">
                             {editingProjectId === proj.id ? (
                               <div className="flex items-center gap-1 flex-1">
                                 <input 
                                   autoFocus
                                   value={editingProjectName}
                                   onChange={(e) => setEditingProjectName(e.target.value)}
                                   onKeyDown={(e) => {
                                     if (e.key === 'Enter') handleRenameProject(proj.id, editingProjectName);
                                     if (e.key === 'Escape') setEditingProjectId(null);
                                   }}
                                   className={`text-sm font-black w-full bg-transparent border-b-2 border-indigo-500 outline-none ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}
                                 />
                                 <button 
                                   onClick={() => handleRenameProject(proj.id, editingProjectName)}
                                   className="p-1 hover:text-indigo-400 text-slate-400"
                                 >
                                   <Save size={14} />
                                 </button>
                               </div>
                             ) : (
                               <button 
                                 onClick={() => loadProject(proj.id)}
                                 className="flex items-center gap-2 overflow-hidden text-left"
                               >
                                 <span className={`text-sm font-black truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{proj.name}</span>
                                 {currentProjectId === proj.id && (
                                   <span className="text-[8px] bg-indigo-500 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Current</span>
                                 )}
                               </button>
                             )}
                           </div>
                           <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Updated {new Date(proj.updatedAt).toLocaleDateString()} at {new Date(proj.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                         </div>
                       </div>
                         <div className="flex items-center gap-1">
                            {projectToDelete === proj.id ? (
                              <motion.div 
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="flex items-center gap-1"
                              >
                                <button 
                                  onClick={() => confirmDeleteProject(proj.id)}
                                  className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-[9px] font-black uppercase hover:bg-red-600 transition-all flex items-center gap-1 active:scale-90 shadow-sm"
                                >
                                  <Check size={12} />
                                  Yes
                                </button>
                                <button 
                                  onClick={() => setProjectToDelete(null)}
                                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all flex items-center gap-1 active:scale-90 ${theme === 'dark' ? 'bg-white/10 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                >
                                  <X size={12} />
                                  No
                                </button>
                              </motion.div>
                            ) : (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button 
                                   onClick={() => {
                                      setEditingProjectId(proj.id);
                                      setEditingProjectName(proj.name);
                                    }}
                                    className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all active:scale-90"
                                    title="Rename Project"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button 
                                    onClick={() => loadProject(proj.id)}
                                    className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all active:scale-90"
                                    title="Open Project"
                                 >
                                   <ChevronRight size={16} />
                                 </button>
                                 <button 
                                   onClick={() => deleteProject(proj.id)}
                                   className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all active:scale-90"
                                   title="Delete Project"
                                 >
                                   <Trash2 size={16} />
                                 </button>
                              </div>
                            )}
                         </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
