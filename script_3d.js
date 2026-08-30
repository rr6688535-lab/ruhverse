/**
 * script_3d.js - Enhanced Procedural 3D Quran Experience
 * High-detail Islamic leather cover, gold embossed arabesques, gilded page edges,
 * ambient gold embers, touch/mouse inertia physics, and responsive viewport scaling.
 */

document.addEventListener('DOMContentLoaded', () => {
    init3DQuran();
});

function init3DQuran() {
    const container = document.getElementById('quran-3d-container');
    if (!container || typeof THREE === 'undefined') return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    
    // Dynamic Camera FOV / distance based on container aspect
    const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 1000);
    const updateCameraDistance = () => {
        const width = container.clientWidth;
        if (width < 420) {
            camera.position.z = 5.6;
        } else if (width < 768) {
            camera.position.z = 5.2;
        } else {
            camera.position.z = 4.8;
        }
    };
    updateCameraDistance();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // --- Lighting Rig ---
    const ambientLight = new THREE.AmbientLight(0xfffaed, 0.75);
    scene.add(ambientLight);

    // Primary warm gold key light
    const keyLight = new THREE.DirectionalLight(0xffe899, 1.4);
    keyLight.position.set(4, 5, 5);
    scene.add(keyLight);

    // Emerald tinted soft fill light
    const fillLight = new THREE.DirectionalLight(0x75d19c, 0.6);
    fillLight.position.set(-5, -2, 3);
    scene.add(fillLight);

    // Golden specular rim light for edge shine
    const rimLight = new THREE.PointLight(0xd4af37, 2.0, 15);
    rimLight.position.set(0, 4, -3);
    scene.add(rimLight);

    // Subtle front accent light
    const frontLight = new THREE.PointLight(0xfff3cc, 1.0, 12);
    frontLight.position.set(0, 0, 4);
    scene.add(frontLight);

    // --- Master Group ---
    const quranGroup = new THREE.Group();
    scene.add(quranGroup);

    // --- Procedural Textures ---

    // 1. Cover Texture (Emerald Leather + Gold Filigree)
    function createCoverTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1360;
        const ctx = canvas.getContext('2d');

        // Background Emerald Leather Gradient
        const bgGrad = ctx.createRadialGradient(512, 680, 50, 512, 680, 750);
        bgGrad.addColorStop(0, '#13472d');
        bgGrad.addColorStop(0.65, '#0b2f1d');
        bgGrad.addColorStop(1, '#061c11');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, 1024, 1360);

        // Subtle leather noise grain
        ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
        for (let i = 0; i < 6000; i++) {
            const rx = Math.random() * 1024;
            const ry = Math.random() * 1360;
            ctx.fillRect(rx, ry, 2, 2);
        }

        // Outer Gold Border Frame
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 14;
        ctx.strokeRect(40, 40, 944, 1280);

        // Inner Gold Border Frame (Double line)
        ctx.lineWidth = 4;
        ctx.strokeRect(65, 65, 894, 1230);
        ctx.lineWidth = 2;
        ctx.strokeRect(85, 85, 854, 1190);

        // Ornate Corner Arabesque Details
        function drawCorner(x, y, flipX, flipY) {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(flipX, flipY);
            ctx.strokeStyle = '#ffd700';
            ctx.fillStyle = 'rgba(212, 175, 55, 0.25)';
            ctx.lineWidth = 4;

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(120, 0);
            ctx.bezierCurveTo(90, 30, 90, 60, 120, 90);
            ctx.lineTo(90, 120);
            ctx.bezierCurveTo(60, 90, 30, 90, 0, 120);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Inner diamond star
            ctx.fillStyle = '#ffeaa7';
            ctx.beginPath();
            ctx.arc(45, 45, 8, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }

        drawCorner(95, 95, 1, 1);
        drawCorner(929, 95, -1, 1);
        drawCorner(95, 1265, 1, -1);
        drawCorner(929, 1265, -1, -1);

        // Center Medallion Background Star
        ctx.save();
        ctx.translate(512, 680);

        // Outer radiating sunburst
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
        ctx.lineWidth = 2;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * 220, Math.sin(a) * 220);
            ctx.lineTo(Math.cos(a) * 245, Math.sin(a) * 245);
            ctx.stroke();
        }

        // Intricate Circular Medallion Rings
        ctx.fillStyle = '#0a291a';
        ctx.beginPath();
        ctx.arc(0, 0, 215, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 10;
        ctx.stroke();

        ctx.fillStyle = 'rgba(212, 175, 55, 0.15)';
        ctx.beginPath();
        ctx.arc(0, 0, 195, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 4;
        ctx.stroke();

        // 8-Pointed Star Filigree
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.7)';
        ctx.lineWidth = 3;
        for (let i = 0; i < 2; i++) {
            ctx.save();
            ctx.rotate(i * (Math.PI / 4));
            ctx.strokeRect(-135, -135, 270, 270);
            ctx.restore();
        }

        // Central Calligraphy: "القرآن الكريم"
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(255, 215, 0, 0.8)';
        ctx.shadowBlur = 18;
        ctx.font = 'bold 110px "Amiri", "Traditional Arabic", serif';
        ctx.fillText('القرآن', 0, -25);
        ctx.font = 'bold 70px "Amiri", "Traditional Arabic", serif';
        ctx.fillText('الكريم', 0, 75);

        ctx.restore();

        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 4;
        return texture;
    }

    // 2. Page Edge Texture (Layered Ivory Pages with Gold Sheen)
    function createPageEdgeTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0, '#d4af37');
        grad.addColorStop(0.15, '#faf5e8');
        grad.addColorStop(0.5, '#edd9a3');
        grad.addColorStop(0.85, '#faf5e8');
        grad.addColorStop(1, '#d4af37');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 128);

        // Fine horizontal page lines
        ctx.fillStyle = 'rgba(160, 120, 40, 0.2)';
        for (let y = 0; y < 128; y += 3) {
            ctx.fillRect(0, y, 512, 1);
        }

        return new THREE.CanvasTexture(canvas);
    }

    const coverTexture = createCoverTexture();
    const pageEdgeTexture = createPageEdgeTexture();

    // --- Materials ---
    const goldLeafMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 0.92,
        roughness: 0.18,
    });

    const coverMaterial = new THREE.MeshStandardMaterial({
        map: coverTexture,
        metalness: 0.35,
        roughness: 0.38,
    });

    const plainEmeraldMat = new THREE.MeshStandardMaterial({
        color: 0x092617,
        metalness: 0.3,
        roughness: 0.45,
    });

    const pageMaterial = new THREE.MeshStandardMaterial({
        map: pageEdgeTexture,
        metalness: 0.55,
        roughness: 0.35,
    });

    // --- Book Geometry Construction ---
    const bookWidth = 2.15;
    const bookHeight = 2.95;
    const bookDepth = 0.52;

    // Materials array for front cover box: [right, left, top, bottom, front, back]
    const coverBoxMat = [
        plainEmeraldMat,
        plainEmeraldMat,
        plainEmeraldMat,
        plainEmeraldMat,
        coverMaterial, // Front cover with ornate texture
        plainEmeraldMat  // Back cover
    ];

    // Main Cover Box
    const coverGeo = new THREE.BoxGeometry(bookWidth, bookHeight, bookDepth);
    const coverMesh = new THREE.Mesh(coverGeo, coverBoxMat);
    quranGroup.add(coverMesh);

    // Inner Pages Block (slightly recessed)
    const pagesGeo = new THREE.BoxGeometry(bookWidth * 0.96, bookHeight * 0.96, bookDepth * 0.86);
    const pagesMesh = new THREE.Mesh(pagesGeo, pageMaterial);
    pagesMesh.position.set(0.04, 0, 0);
    quranGroup.add(pagesMesh);

    // Spine Raised Ribs (5 decorative golden leather bands)
    const spineX = -bookWidth / 2 - 0.005;
    for (let r = 0; r < 5; r++) {
        const ribY = (r - 2) * 0.52;
        const ribGeo = new THREE.CylinderGeometry(0.032, 0.032, bookDepth * 0.95, 16);
        const ribMesh = new THREE.Mesh(ribGeo, goldLeafMat);
        ribMesh.rotation.x = Math.PI / 2;
        ribMesh.position.set(spineX, ribY, 0);
        quranGroup.add(ribMesh);
    }

    // Spine Gold Vertical Filigree Accent
    const spineBandGeo = new THREE.BoxGeometry(0.02, bookHeight * 0.88, 0.04);
    const spineBand = new THREE.Mesh(spineBandGeo, goldLeafMat);
    spineBand.position.set(spineX + 0.015, 0, 0);
    quranGroup.add(spineBand);

    // Silk Ribbon Bookmark trailing from bottom
    const ribbonCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.2, -bookHeight / 2 + 0.05, 0),
        new THREE.Vector3(0.25, -bookHeight / 2 - 0.25, 0.08),
        new THREE.Vector3(0.18, -bookHeight / 2 - 0.55, 0.15),
        new THREE.Vector3(0.28, -bookHeight / 2 - 0.82, 0.12)
    ]);
    const ribbonGeo = new THREE.TubeGeometry(ribbonCurve, 24, 0.035, 8, false);
    const ribbonMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.3,
        metalness: 0.7
    });
    const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
    quranGroup.add(ribbon);

    // --- Floating Golden Particle Embers ---
    const particleCount = 65;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleScales = new Float32Array(particleCount);

    for (let p = 0; p < particleCount; p++) {
        const radius = 2.4 + Math.random() * 2.2;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);

        particlePositions[p * 3] = radius * Math.sin(phi) * Math.cos(theta);
        particlePositions[p * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        particlePositions[p * 3 + 2] = radius * Math.cos(phi);
        particleScales[p] = Math.random() * 0.8 + 0.4;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('scale', new THREE.BufferAttribute(particleScales, 1));

    // Particle Texture Canvas (Soft glowing golden dot)
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 64;
    pCanvas.height = 64;
    const pCtx = pCanvas.getContext('2d');
    const pGrad = pCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    pGrad.addColorStop(0, 'rgba(255, 235, 140, 1)');
    pGrad.addColorStop(0.35, 'rgba(212, 175, 55, 0.8)');
    pGrad.addColorStop(1, 'rgba(212, 175, 55, 0)');
    pCtx.fillStyle = pGrad;
    pCtx.fillRect(0, 0, 64, 64);

    const particleMat = new THREE.PointsMaterial({
        size: 0.12,
        map: new THREE.CanvasTexture(pCanvas),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // Initial Aesthetic Orientation
    quranGroup.rotation.x = 0.22;
    quranGroup.rotation.y = 0.45;
    quranGroup.rotation.z = -0.05;

    // --- Interaction Physics (Inertia Damping + Touch Gestures) ---
    let isInteracting = false;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let velocityX = 0;
    let velocityY = 0;
    let targetTiltX = 0;
    let targetTiltY = 0;

    function onPointerDown(clientX, clientY) {
        isInteracting = true;
        pointerStartX = clientX;
        pointerStartY = clientY;
        velocityX = 0;
        velocityY = 0;
    }

    function onPointerMove(clientX, clientY) {
        if (!isInteracting) {
            // Subtle hover parallax
            const rect = container.getBoundingClientRect();
            const normX = ((clientX - rect.left) / rect.width) * 2 - 1;
            const normY = -(((clientY - rect.top) / rect.height) * 2 - 1);
            targetTiltX = normY * 0.15;
            targetTiltY = normX * 0.25;
            return;
        }

        const deltaX = clientX - pointerStartX;
        const deltaY = clientY - pointerStartY;

        velocityX = deltaX * 0.007;
        velocityY = deltaY * 0.007;

        quranGroup.rotation.y += velocityX;
        quranGroup.rotation.x += velocityY;

        pointerStartX = clientX;
        pointerStartY = clientY;
    }

    function onPointerUp() {
        isInteracting = false;
    }

    // Mouse Listeners
    container.addEventListener('mousedown', (e) => onPointerDown(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onPointerMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onPointerUp);

    // Touch Listeners (Mobile & Tablet)
    container.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (isInteracting && e.touches.length > 0) {
            onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });

    window.addEventListener('touchend', onPointerUp);

    // Device Tilt / Parallax fallback
    if (window.DeviceOrientationEvent && 'ontouchstart' in window) {
        window.addEventListener('deviceorientation', (e) => {
            if (e.gamma !== null && e.beta !== null && !isInteracting) {
                targetTiltY = THREE.MathUtils.clamp(e.gamma / 45, -0.3, 0.3);
                targetTiltX = THREE.MathUtils.clamp((e.beta - 45) / 45, -0.2, 0.2);
            }
        }, { passive: true });
    }

    // --- Animation Loop ---
    let clock = new THREE.Clock();

    function renderFrame() {
        requestAnimationFrame(renderFrame);

        const elapsedTime = clock.getElapsedTime();

        if (!isInteracting) {
            // Apply inertia physics
            velocityX *= 0.94;
            velocityY *= 0.94;

            quranGroup.rotation.y += velocityX + 0.0045; // Gentle auto-rotation
            quranGroup.rotation.x += velocityY;

            // Idle floating wave
            quranGroup.position.y = Math.sin(elapsedTime * 1.2) * 0.1;
            
            // Soft blend towards tilt
            quranGroup.rotation.x += (0.22 + targetTiltX - quranGroup.rotation.x) * 0.03;
        }

        // Orbiting particles
        particles.rotation.y = elapsedTime * 0.08;
        particles.rotation.x = Math.sin(elapsedTime * 0.05) * 0.15;

        renderer.render(scene, camera);
    }

    renderFrame();

    // --- Responsive Resize Handler ---
    function handleResize() {
        if (!container) return;
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width === 0 || height === 0) return;

        camera.aspect = width / height;
        updateCameraDistance();
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }

    window.addEventListener('resize', handleResize);
}
