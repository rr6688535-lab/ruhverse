/**
 * script_3d.js - Procedural 3D Quran Model using Three.js
 */

document.addEventListener('DOMContentLoaded', () => {
    init3DQuran();
});

function init3DQuran() {
    const container = document.getElementById('quran-3d-container');
    if (!container) return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xd4af37, 1.2); // Gold-tinted light
    pointLight.position.set(5, 5, 5);
    scene.add(pointLight);

    const spotLight = new THREE.SpotLight(0xffffff, 0.5);
    spotLight.position.set(0, 10, 0);
    scene.add(spotLight);

    // --- Quran Model Construction ---
    const bookGroup = new THREE.Group();

    // 1. The Cover (Emerald Green Leather)
    // We'll create a slightly larger box for the cover
    const coverGeo = new THREE.BoxGeometry(2.1, 2.8, 0.5);
    const coverMat = new THREE.MeshStandardMaterial({
        color: 0x0a3d2e, // Deep Emerald
        roughness: 0.4,
        metalness: 0.3,
    });
    const cover = new THREE.Mesh(coverGeo, coverMat);
    bookGroup.add(cover);

    // 2. The Pages (White/Cream)
    // Slightly smaller box inside the cover
    const pagesGeo = new THREE.BoxGeometry(2.0, 2.7, 0.45);
    const pagesMat = new THREE.MeshStandardMaterial({
        color: 0xfaf9f6, // Off-white/Cream
        roughness: 0.8,
    });
    const pages = new THREE.Mesh(pagesGeo, pagesMat);
    pages.position.z = 0;
    bookGroup.add(pages);

    // --- Detail: Page Lines on Sides ---
    // We add thin dark lines on the sides to simulate pages
    for (let i = -20; i <= 20; i++) {
        const lineGeo = new THREE.BoxGeometry(0.01, 2.7, 0.005);
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });

        // Right side
        const lineR = new THREE.Mesh(lineGeo, lineMat);
        lineR.position.set(1.0, 0, (i * 0.01));
        bookGroup.add(lineR);

        // Left side
        const lineL = new THREE.Mesh(lineGeo, lineMat);
        lineL.position.set(-1.0, 0, (i * 0.01));
        bookGroup.add(lineL);
    }

    // 3. Gold Decoration (Simplified 3D Ornament)
    // A central circular "seal" with Arabic Text
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Background Gold
    ctx.fillStyle = '#d4af37';
    ctx.fillRect(0, 0, 512, 512);

    // Arabic Text "القرآن"
    ctx.fillStyle = '#1a3c2f'; // Dark Emerald for contrast
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 120px Amiri, serif';
    ctx.fillText('القرآن', 256, 256);

    // Texture
    const sealTexture = new THREE.CanvasTexture(canvas);

    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37, // Gold
        metalness: 0.9,
        roughness: 0.2,
    });

    const sealGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.05, 32);
    const sealMat = new THREE.MeshStandardMaterial({
        map: sealTexture,
        metalness: 0.7,
        roughness: 0.3,
    });

    const seal = new THREE.Mesh(sealGeo, sealMat);
    seal.rotation.x = Math.PI / 2;
    seal.position.z = 0.26; // On front cover
    bookGroup.add(seal);

    // Gold borders (top and bottom bars)
    const barGeo = new THREE.BoxGeometry(1.6, 0.04, 0.02);
    const topBar = new THREE.Mesh(barGeo, goldMat);
    topBar.position.set(0, 1.0, 0.26);
    bookGroup.add(topBar);

    const botBar = new THREE.Mesh(barGeo, goldMat);
    botBar.position.set(0, -1.0, 0.26);
    bookGroup.add(botBar);

    scene.add(bookGroup);

    // --- Interaction State ---
    let targetRotationX = 0.2;
    let targetRotationY = 0.5;
    let mouseX = 0;
    let mouseY = 0;
    let isDragging = false;
    let previousMouseX = 0;
    let previousMouseY = 0;

    // --- Animation Loop ---
    function animate() {
        requestAnimationFrame(animate);

        if (!isDragging) {
            // Natural floating/rotating animation
            bookGroup.rotation.y += 0.005;
            bookGroup.position.y = Math.sin(Date.now() * 0.001) * 0.1;
        }

        renderer.render(scene, camera);
    }

    animate();

    // --- Event Listeners ---
    container.addEventListener('mousedown', (e) => {
        isDragging = true;
        previousMouseX = e.clientX;
        previousMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const deltaX = e.clientX - previousMouseX;
            const deltaY = e.clientY - previousMouseY;

            bookGroup.rotation.y += deltaX * 0.01;
            bookGroup.rotation.x += deltaY * 0.01;

            previousMouseX = e.clientX;
            previousMouseY = e.clientY;
        }
    });

    // Handle Resize
    window.addEventListener('resize', () => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    });
}
