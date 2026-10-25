/* LoteVivo — mundo 3D (Three.js r147, build UMD) */
window.LV = window.LV || {};
(function (LV) {
  'use strict';
  const T = window.THREE;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeBack = (t) => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const lin = (hex) => new T.Color(hex).convertSRGBToLinear();
  const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

  /* ruído de valor, para o relevo ao redor */
  function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
  }
  function fbm(x, y) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }

  /* gradiente do "modo valor" */
  const VAL = ['#19b3a6', '#7fd36b', '#f2c14e', '#ff7a45'].map((h) => new T.Color(h));
  function valColor(t) {
    t = clamp(t, 0, 1) * (VAL.length - 1); const i = Math.min(VAL.length - 2, Math.floor(t));
    return VAL[i].clone().lerp(VAL[i + 1], t - i).convertSRGBToLinear();
  }

  class Scene3D {
    constructor(el, hooks) {
      this.el = el; this.hooks = hooks || {};
      this.entries = []; this.byId = new Map();
      this.mode = 'status'; this.hour = 15.5; this.filter = null; this.selected = null; this.hovered = null;
      this.clock = new T.Clock();

      const r = this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
      r.outputEncoding = T.sRGBEncoding;
      r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
      r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
      el.appendChild(r.domElement);

      this.labels = document.createElement('div'); this.labels.className = 'labels3d'; el.appendChild(this.labels);

      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(40, 1, 1, 20000);
      this.controls = new T.OrbitControls(this.camera, r.domElement);
      Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: 1.36, rotateSpeed: 0.6, zoomSpeed: 0.9, autoRotateSpeed: 0.5 });

      this.hemi = new T.HemisphereLight(0xbfdcff, 0x2c3a22, 0.5); this.scene.add(this.hemi);
      this.sun = new T.DirectionalLight(0xffffff, 1.4); this.sun.castShadow = true; this.scene.add(this.sun, this.sun.target);
      this.moon = new T.DirectionalLight(0x7f9cff, 0); this.scene.add(this.moon);

      this.ray = new T.Raycaster(); this.mouse = new T.Vector2();
      this._bindPointer();
      this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(el);
      this.resize();
      const loop = () => { this._raf = requestAnimationFrame(loop); this.tick(); };
      loop();
    }

    resize() {
      const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
      this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      // ao girar o celular (retrato ⇄ paisagem), reenquadra se ninguém estiver com um lote aberto
      const port = h > w;
      if (this.world && this._port != null && this._port !== port && !this.selected && !this.fly) {
        clearTimeout(this._reframe);
        this._reframe = setTimeout(() => { if (!this.selected && !this.fly) this.overview(); }, 350);
      }
      this._port = port;
    }

    /* ------------------------------------------------------------ construção */
    async load(p, opts) {
      opts = opts || {};
      this.p = p;
      const keep = opts.keepCamera && this.world;
      if (this.world) this._disposeWorld();
      this.world = new T.Group(); this.scene.add(this.world);
      this.entries = []; this.byId.clear(); this.labels.innerHTML = ''; this.selected = null; this.hovered = null;

      const mpu = p.mpu; this.mpu = mpu;
      const Ww = p.W * mpu, Hw = p.H * mpu, S = this.S = Math.max(Ww, Hw);
      this.half = [Ww / 2, Hw / 2];
      this.toW = (x, y) => [(x - p.W / 2) * mpu, (y - p.H / 2) * mpu];
      this._setupRelevo(p);

      this.camera.near = S / 400; this.camera.far = S * 14; this.camera.updateProjectionMatrix();
      Object.assign(this.controls, { minDistance: S * 0.035, maxDistance: S * 2.3 });

      this._sky(S); this._terrain(S, Ww, Hw);
      const canvas = await LV.groundCanvas(p, isMobile ? 2048 : 4096);
      const tex = new T.CanvasTexture(canvas);
      tex.encoding = T.sRGBEncoding; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      // chão do loteamento: com relevo real, a malha acompanha a altimetria do terreno
      const segX = this.dem ? Math.min(isMobile ? 180 : 320, Math.round(Ww / 5)) : 1;
      const segY = this.dem ? Math.max(1, Math.round(segX * Hw / Ww)) : 1;
      const gg = new T.PlaneGeometry(Ww, Hw, segX, segY).rotateX(-Math.PI / 2);
      if (this.dem) { const gp = gg.attributes.position; for (let i = 0; i < gp.count; i++) gp.setY(i, this.ground(gp.getX(i), gp.getZ(i))); gg.computeVertexNormals(); }
      const ground = new T.Mesh(gg, new T.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
      ground.receiveShadow = true; this.world.add(ground); this.groundMesh = ground;
      if (!this.dem) {
        const slab = new T.Mesh(new T.BoxGeometry(Ww, S * 0.006, Hw), new T.MeshStandardMaterial({ color: lin('#2a3524'), roughness: 1 }));
        slab.position.y = -S * 0.003 - 1.2; this.world.add(slab);
      }

      if (p.demo) this._demoExtras(p);
      this._trees(p, S, Ww, Hw);
      this._clouds(S);
      this._lots(p);
      this._quadraLabels(p);

      const sh = this.sun.shadow; const half = S * 0.62;
      Object.assign(sh.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: S * 5 });
      sh.mapSize.set(isMobile ? 2048 : 4096, isMobile ? 2048 : 4096); sh.bias = -0.0004; sh.normalBias = 0.6;
      sh.camera.updateProjectionMatrix();
      if (sh.map) { sh.map.dispose(); sh.map = null; }

      this.setHour(this.hour);
      this.setMode(this.mode);
      if (this.filter) this.setFilter(this.filter);

      if (keep) { this.entries.forEach((e) => (e.appear = 1)); }
      else this.intro();
      if (this.hooks.onReady) this.hooks.onReady();
    }

    _disposeWorld() {
      this.world.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      });
      this.scene.remove(this.world);
      this.house = null; this.ring = null; this.beams = null;
    }

    _sky(S) {
      const mat = new T.ShaderMaterial({
        side: T.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new T.Color() }, hor: { value: new T.Color() }, bot: { value: new T.Color('#0b130e') }, sunDir: { value: new T.Vector3() }, sunCol: { value: new T.Color() } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: [
          'uniform vec3 top, hor, bot, sunDir, sunCol; varying vec3 vP;',
          'void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.5)) : mix(hor, bot, pow(-h, 0.35));',
          ' float s = max(dot(vP, normalize(sunDir)), 0.0); c += sunCol * (pow(s, 600.0) * 1.2 + pow(s, 8.0) * 0.25);',
          ' gl_FragColor = vec4(c, 1.0); }'
        ].join('\n')
      });
      this.skyMat = mat;
      this.world.add(new T.Mesh(new T.SphereGeometry(S * 6, 32, 16), mat));
      const n = 1600, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * Math.PI * 2, v = Math.random() * 0.95, r = S * 5.5;
        pos.set([Math.cos(u) * Math.sqrt(1 - v * v) * r, v * r, Math.sin(u) * Math.sqrt(1 - v * v) * r], i * 3);
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
      this.stars = new T.Points(g, new T.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
      this.world.add(this.stars);
      this.scene.fog = new T.Fog(0x9fc3dd, S * 1.2, S * 5);
    }

    /* lote assentado no terreno: base enterrada 1,2 m e topo a "hh" metros acima da cota de cada vértice */
    _lotH(e, hh) {
      for (const t of e.terrain) {
        const a = t.a, arr = a.array;
        for (let i = 0; i < a.count; i++) arr[i * 3 + 1] = t.u[i] ? t.tH[i] + hh : t.tH[i] - 1.2;
        a.needsUpdate = true;
      }
      const g = e.mesh.geometry; g.computeBoundingSphere(); g.computeBoundingBox();
      e.mesh.children[0] && e.mesh.children[0].geometry.computeBoundingSphere();
    }

    /* relevo real (modelo do terreno vindo das curvas de nível do projeto) */
    _setupRelevo(p) {
      this.dem = null; this.zRef = 0; this.ground = () => 0;
      const r = p.relevo; if (!r || !r.data) return;
      try {
        const bin = atob(r.data), n = bin.length >> 1, dem = new Float32Array(n);
        for (let i = 0; i < n; i++) dem[i] = r.zmin + (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) / 10;
        const mpu = p.mpu, gw = r.w, gh = r.h, st = r.step;
        const raw = (x, z) => {
          const fx = clamp((x / mpu + p.W / 2) / st, 0, gw - 1.001), fy = clamp((z / mpu + p.H / 2) / st, 0, gh - 1.001);
          const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * gw + i;
          return (dem[k] * (1 - u) + dem[k + 1] * u) * (1 - v) + (dem[k + gw] * (1 - u) + dem[k + gw + 1] * u) * v;
        };
        const zs = p.lots.filter((l) => l.poly).map((l) => { const c = LV.geo.centroid(l.poly); const w = this.toW(c[0], c[1]); return raw(w[0], w[1]); }).sort((a, b) => a - b);
        this.zRef = zs.length ? zs[zs.length >> 1] : r.zmin;
        this.ground = (x, z) => (raw(x, z) - this.zRef) * mpu;
        this.dem = dem;
      } catch (e) { console.warn('relevo inválido', e); }
    }

    _height(x, z) {
      const S = this.S, m = S * 0.03;
      const dx = Math.max(0, Math.abs(x) - this.half[0] - m), dz = Math.max(0, Math.abs(z) - this.half[1] - m);
      const k = clamp(Math.hypot(dx, dz) / (S * 0.55), 0, 1);
      const sk = k * k * (3 - 2 * k);
      if (this.dem) {
        // fora do terreno do projeto: continua a altimetria da borda, com morros suaves crescendo com a distância
        const inside = Math.abs(x) < this.half[0] && Math.abs(z) < this.half[1];
        const base = this.ground(clamp(x, -this.half[0], this.half[0]), clamp(z, -this.half[1], this.half[1]));
        return base + sk * (fbm(x / S * 2.6 + 3.1, z / S * 2.6 - 1.7) - 0.35) * S * 0.14 - (inside ? 9 : 2);
      }
      return sk * (fbm(x / S * 2.6 + 3.1, z / S * 2.6 - 1.7) * S * 0.2) - 3 - S * 0.006;
    }

    _terrain(S) {
      const seg = this.dem ? (isMobile ? 200 : 320) : (isMobile ? 110 : 180);
      const ext = this.dem ? 6 : 9;
      const g = new T.PlaneGeometry(S * ext, S * ext, seg, seg).rotateX(-Math.PI / 2);
      const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
      const a = lin('#1b2c1f'), b = lin('#355230'), c = lin('#5b5a3c'), tmp = new T.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), y = this._height(x, z);
        pos.setY(i, y);
        const n = fbm(x / S * 9, z / S * 9);
        tmp.copy(a).lerp(b, n).lerp(c, clamp(y / (S * 0.16), 0, 1) * (this.dem ? 0.15 : 0.35));
        col.set([tmp.r, tmp.g, tmp.b], i * 3);
      }
      g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeVertexNormals();
      const m = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
      m.receiveShadow = true; this.world.add(m);
    }

    _trees(p, S) {
      const pts = [];
      const R = LV.rng(5);
      const n = isMobile ? 900 : 2400;
      for (let i = 0; pts.length < n && i < n * 4; i++) {
        const x = (R() - 0.5) * S * 4.4, z = (R() - 0.5) * S * 4.4;
        const dx = Math.abs(x) - this.half[0], dz = Math.abs(z) - this.half[1];
        if (dx < S * 0.012 && dz < S * 0.012) continue;
        pts.push([x, this._height(x, z), z, 1]);
      }
      if (p.demo) {
        const d = p.demo, warp = LV.makeWarp(d.warp);
        const zones = d.zones.filter((z) => z.type === 'verde' || z.type === 'margem');
        zones.forEach((zn) => {
          const b = LV.geo.bbox(zn.poly);
          for (let i = 0; i < (zn.type === 'verde' ? 26 : 12); i++) {
            const ux = b.x0 + 4 + R() * (b.w - 8), uy = b.y0 + 4 + R() * (b.h - 8);
            if (Math.hypot((ux - d.lake.x) / (d.lake.rx + 6), (uy - d.lake.y) / (d.lake.ry + 6)) < 1) continue;
            const [wx, wy] = warp(ux, uy), [x, z] = this.toW(wx, wy);
            pts.push([x, 0, z, 0.8]);
          }
        });
        for (let i = 0; i < 1600; i++) {
          const ux = R() * p.W, uy = R() * p.H;
          if (LV.geo.pip([ux, uy], d.blob)) continue;
          const [wx, wy] = warp(ux, uy), [x, z] = this.toW(wx, wy);
          pts.push([x, 0, z, 0.9]);
        }
      }
      const crownG = new T.IcosahedronGeometry(1, 0), trunkG = new T.CylinderGeometry(0.12, 0.18, 1, 5).translate(0, 0.5, 0);
      const crown = new T.InstancedMesh(crownG, new T.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), pts.length);
      const trunk = new T.InstancedMesh(trunkG, new T.MeshStandardMaterial({ color: lin('#4a3828'), roughness: 1 }), pts.length);
      const m = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), c = new T.Color();
      const greens = ['#2f5a2c', '#3b6b33', '#2a4f29', '#4d7d3c', '#5a7a35', '#36612f'].map(lin);
      pts.forEach((t, i) => {
        const h = (5 + R() * 7) * t[3], w = h * (0.32 + R() * 0.16);
        q.setFromAxisAngle(new T.Vector3(0, 1, 0), R() * 6.3);
        m.compose(ps.set(t[0], t[1], t[2]), q, sc.set(1, h * 0.45, 1)); trunk.setMatrixAt(i, m);
        m.compose(ps.set(t[0], t[1] + h * 0.62, t[2]), q, sc.set(w, h * 0.42, w)); crown.setMatrixAt(i, m);
        crown.setColorAt(i, c.copy(greens[Math.floor(R() * greens.length)]));
      });
      crown.castShadow = trunk.castShadow = true; crown.receiveShadow = true;
      this.world.add(crown, trunk);
    }

    _clouds(S) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      for (let i = 0; i < 9; i++) {
        const x = 30 + Math.random() * 68, y = 44 + Math.random() * 40, r = 18 + Math.random() * 26;
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      }
      const tex = new T.CanvasTexture(cv);
      this.clouds = [];
      for (let i = 0; i < 16; i++) {
        const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
        const s = S * (0.25 + Math.random() * 0.35);
        sp.scale.set(s, s * 0.5, 1);
        sp.position.set((Math.random() - 0.5) * S * 3, S * (0.42 + Math.random() * 0.25), (Math.random() - 0.5) * S * 3);
        this.clouds.push(sp); this.world.add(sp);
      }
    }

    _demoExtras(p) {
      const d = p.demo, warp = LV.makeWarp(d.warp), mpu = p.mpu;
      // lago
      const shape = new T.Shape();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2, c = Math.cos(-0.12), s = Math.sin(-0.12);
        const ex = Math.cos(a) * d.lake.rx, ey = Math.sin(a) * d.lake.ry;
        const [lx, ly] = warp(d.lake.x, d.lake.y);
        const [x, z] = this.toW(lx + ex * c - ey * s, ly + ex * s + ey * c);
        i ? shape.lineTo(x, -z) : shape.moveTo(x, -z);
      }
      const water = new T.Mesh(new T.ShapeGeometry(shape).rotateX(-Math.PI / 2),
        new T.MeshStandardMaterial({ color: lin('#2a7aa3'), roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.9 }));
      water.position.y = 0.15; water.receiveShadow = true; this.water = water; this.world.add(water);
      const white = new T.MeshStandardMaterial({ color: lin('#eeebe3'), roughness: 0.6 });
      const gold = new T.MeshStandardMaterial({ color: lin('#c9a45c'), roughness: 0.4, metalness: 0.4 });
      const box = (w, h, dd, x, z, mat, ry) => {
        const m = new T.Mesh(new T.BoxGeometry(w * mpu, h, dd * mpu), mat);
        m.position.set(x, h / 2, z); m.rotation.y = ry || 0; m.castShadow = m.receiveShadow = true; this.world.add(m); return m;
      };
      if (d.clube) {
        const cz = d.zones.find((z) => z.type === 'clube'); const b = LV.geo.bbox(cz.poly);
        const [wx, wy] = warp(b.x0 + b.w * 0.3, b.y0 + b.h * 0.33); const [x, z] = this.toW(wx, wy);
        box(b.w * 0.32, 5, b.h * 0.28, x, z, white); box(b.w * 0.36, 0.5, b.h * 0.34, x, z, gold).position.y = 5.2;
      }
      const [px, py] = warp(d.portaria[0], d.portaria[1]); const [x, z] = this.toW(px, py);
      box(16, 4, 7, x, z, white); box(19, 0.45, 9, x, z, gold).position.y = 4.2;
    }

    _lots(p) {
      const mpu = p.mpu, S = this.S;
      const pinG = new T.SphereGeometry(1, 20, 14), coneG = new T.ConeGeometry(0.62, 1.6, 20).rotateX(Math.PI);
      for (const l of p.lots) {
        let mesh, c, size;
        const color = lin(LV.STATUS[l.status] ? LV.STATUS[l.status].color : '#888');
        const mat = new T.MeshStandardMaterial({ color: color.clone(), roughness: 0.62, metalness: 0.0, emissive: color.clone(), emissiveIntensity: 0.1, transparent: true });
        if (l.poly && l.poly.length > 2) {
          const pts = LV.geo.inset(l.poly, 0.55 / mpu).map((v) => this.toW(v[0], v[1]));
          const shape = new T.Shape(pts.map((v) => new T.Vector2(v[0], -v[1])));
          const g = new T.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).rotateX(-Math.PI / 2);
          const eg = new T.EdgesGeometry(g, 25);
          mesh = new T.Mesh(g, mat);
          const edges = new T.LineSegments(eg, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
          mesh.add(edges);
          c = this.toW(...LV.geo.centroid(l.poly));
          size = Math.sqrt(LV.geo.area(l.poly)) * mpu;
          mesh.receiveShadow = true;
          // com relevo: guarda a cota de cada vértice; a espessura do lote é aplicada por cima dela (ver _lotH)
          if (this.dem) {
            const prep = (geo) => { const a = geo.attributes.position, n = a.count, tH = new Float32Array(n), u = new Uint8Array(n); for (let i = 0; i < n; i++) { u[i] = a.getY(i) > 0.5 ? 1 : 0; tH[i] = this.ground(a.getX(i), a.getZ(i)); } return { a, tH, u }; };
            mesh.userData.terrain = [prep(g), prep(eg)];
            // topo do lote com a normal do terreno (fica liso como o chão, sem facetas)
            const nm = g.attributes.normal, gp = g.attributes.position, e2 = 1.5;
            for (let i = 0; i < nm.count; i++) {
              if (nm.getY(i) < 0.9) continue;
              const x = gp.getX(i), z = gp.getZ(i);
              const dx = (this.ground(x + e2, z) - this.ground(x - e2, z)) / (2 * e2), dz = (this.ground(x, z + e2) - this.ground(x, z - e2)) / (2 * e2);
              const L = Math.hypot(dx, 1, dz); nm.setXYZ(i, -dx / L, 1 / L, -dz / L);
            }
            nm.needsUpdate = true;
          }
        } else if (l.pin) {
          c = this.toW(l.pin[0], l.pin[1]);
          size = S / 60;
          mesh = new T.Group();
          const head = new T.Mesh(pinG, mat), tip = new T.Mesh(coneG, mat);
          head.position.y = 2.4; tip.position.y = 1.2; head.castShadow = tip.castShadow = true;
          mesh.add(head, tip); mesh.scale.setScalar(size * 0.35); mesh.position.set(c[0], this.ground(c[0], c[1]), c[1]);
          mesh.userData.isPin = true;
        } else continue;
        const e = { lot: l, mesh, mat, base: color, c, gy: this.ground(c[0], c[1]), size, isPin: !!mesh.userData.isPin, terrain: mesh.userData.terrain || null, h: 0.7, hT: 0.7, lift: 0, liftT: 0, dim: 0, dimT: 0, appear: 0, delay: 0, val: 0 };
        mesh.traverse((o) => (o.userData.entry = e));
        this.entries.push(e); this.byId.set(l.id, e); this.world.add(mesh);
      }
      const prices = this.entries.map((e) => e.lot.area ? e.lot.preco / e.lot.area : 0).filter((v) => v > 0);
      const lo = Math.min(...prices), hi = Math.max(...prices);
      this.entries.forEach((e) => { const v = e.lot.area ? e.lot.preco / e.lot.area : 0; e.val = hi > lo ? (v - lo) / (hi - lo) : 0.5; });
      this.pickables = [];
      this.entries.forEach((e) => e.mesh.traverse((o) => o.isMesh && this.pickables.push(o)));
    }

    _quadraLabels(p) {
      const groups = {};
      this.entries.forEach((e) => { (groups[e.lot.quadra] = groups[e.lot.quadra] || []).push(e.c); });
      this.qLabels = Object.entries(groups).map(([q, cs]) => {
        const el = document.createElement('div'); el.className = 'ql'; el.textContent = 'Q' + q;
        el.title = 'Quadra ' + q + ' · ver de perto';
        el.dataset.q = q;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (this.hooks.onQuadra) this.hooks.onQuadra(q); else this.focusQuadra(q);
        });
        this.labels.appendChild(el);
        const x = cs.reduce((s, c) => s + c[0], 0) / cs.length, z = cs.reduce((s, c) => s + c[1], 0) / cs.length;
        const b = { x0: Math.min(...cs.map((c) => c[0])), x1: Math.max(...cs.map((c) => c[0])), z0: Math.min(...cs.map((c) => c[1])), z1: Math.max(...cs.map((c) => c[1])) };
        return { el, q: String(q), b, n: cs.length, v: new T.Vector3(x, this.ground(x, z) + 4, z) };
      });
      // de longe várias quadras se encavalam na tela: as maiores ficam com a vez
      this.qOrder = this.qLabels.slice().sort((a, b) => b.n - a.n);
      this.lLabels = this.entries.filter((e) => !e.isPin).map((e) => {
        const el = document.createElement('div'); el.className = 'll'; el.textContent = LV.fmt.pad(e.lot.lote);
        this.labels.appendChild(el); return { el, e, v: new T.Vector3() };
      });
      this.mLabels = [];
    }

    /* ------------------------------------------------------------ estados */
    intro() {
      const S = this.S;
      this.entries.forEach((e) => { e.appear = 0; e.delay = 0.6 + (Math.hypot(e.c[0], e.c[1]) / S) * 1.8 + Math.random() * 0.15; });
      this.introStart = this.clock.getElapsedTime();
      this.camera.position.set(-S * 0.9, S * 1.3, S * 1.5);
      this.controls.target.set(0, 0, 0);
      const v = this._view();
      this.flyTo(v.pos, v.target, 3.6);
    }

    /* enquadra o conjunto dos lotes, não a imagem inteira */
    _view() {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      this.entries.forEach((e) => { x0 = Math.min(x0, e.c[0]); x1 = Math.max(x1, e.c[0]); z0 = Math.min(z0, e.c[1]); z1 = Math.max(z1, e.c[1]); });
      if (!isFinite(x0)) { x0 = z0 = -this.S / 2; x1 = z1 = this.S / 2; }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, R = Math.max(x1 - x0, z1 - z0, this.S * 0.2);
      // em tela estreita (celular em pé) a câmera recua para o loteamento inteiro caber na largura
      const aspect = (this.el.clientWidth || 1) / (this.el.clientHeight || 1);
      const k = clamp(1.15 / aspect, 1, 2.1);
      const gy = this.ground(cx, cz);
      return { target: new T.Vector3(cx, gy, cz), pos: new T.Vector3(cx + R * 0.2 * k, gy + R * 0.62 * k, cz + R * 0.78 * k), R };
    }

    overview() { const v = this._view(); this.flyTo(v.pos, v.target, 1.6); }
    topView() { const v = this._view(); this.flyTo(new T.Vector3(v.target.x, v.target.y + v.R * 1.25, v.target.z + v.R * 0.02), v.target, 1.4); }

    flyTo(pos, target, dur) {
      this.fly = { p0: this.camera.position.clone(), p1: pos, t0: this.controls.target.clone(), t1: target, start: this.clock.getElapsedTime(), dur: dur || 1.4 };
      this.controls.enabled = false;
    }

    focus(id) {
      const e = this.byId.get(id); if (!e) return;
      const target = new T.Vector3(e.c[0], e.gy, e.c[1]);
      const dir = this.camera.position.clone().sub(this.controls.target); dir.y = 0;
      if (dir.lengthSq() < 1) dir.set(0, 0, 1);
      dir.normalize();
      const d = clamp(e.size * 4.6, this.S * 0.1, this.S * 0.45);
      this.flyTo(target.clone().addScaledVector(dir, d * 0.85).add(new T.Vector3(0, d * 0.75, 0)), target, 1.5);
    }

    /* leva a câmera até a quadra inteira, sem escolher lote */
    focusQuadra(q) {
      const g = this.qLabels && this.qLabels.find((x) => x.q === String(q));
      if (!g) return;
      const cx = (g.b.x0 + g.b.x1) / 2, cz = (g.b.z0 + g.b.z1) / 2;
      const target = new T.Vector3(cx, this.ground(cx, cz), cz);
      const R = Math.max(g.b.x1 - g.b.x0, g.b.z1 - g.b.z0, this.S * 0.04);
      const dir = this.camera.position.clone().sub(this.controls.target); dir.y = 0;
      if (dir.lengthSq() < 1) dir.set(0, 0, 1);
      dir.normalize();
      const d = clamp(R * 1.7, this.S * 0.1, this.S * 0.7);
      this.flyTo(target.clone().addScaledVector(dir, d * 0.8).add(new T.Vector3(0, d * 0.72, 0)), target, 1.5);
    }

    select(id, fly) {
      const prev = this.selected; this.selected = id ? this.byId.get(id) || null : null;
      if (prev && prev !== this.selected) prev.liftT = 0;
      this._removeHouse(); this.mLabels.forEach((m) => m.el.remove()); this.mLabels = [];
      if (!this.selected) return;
      const e = this.selected; e.liftT = e.isPin ? 0 : 1.6;
      if (fly !== false) this.focus(id);
      if (!e.isPin) { this._house(e); this._measures(e); }
      this._ring(e);
    }

    _ring(e) {
      if (!this.ring) {
        this.ring = new T.Mesh(new T.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2),
          new T.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, depthTest: !this.dem }));
        this.ring.renderOrder = 6;
        this.world.add(this.ring);
      }
      this.ring.visible = true; this.ring.position.set(e.c[0], e.gy + 0.3, e.c[1]); this.ring.userData.size = e.size * 0.9; this.ring.userData.t0 = this.clock.getElapsedTime();
    }

    _removeHouse() { if (this.house) { this.house.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); this.world.remove(this.house); this.house = null; } if (this.ring) this.ring.visible = false; }

    /* casa fantasma: ajuda o cliente a sentir a escala do lote e a sombra ao longo do dia */
    _house(e) {
      const poly = e.lot.poly.map((v) => this.toW(v[0], v[1]));
      const edges = LV.geo.edges(poly);
      const long = edges.reduce((a, b) => (b.len > a.len ? b : a));
      const short = edges.reduce((a, b) => (b.len < a.len ? b : a));
      const depth = long.len, width = short.len;
      const g = new T.Group();
      const wall = new T.MeshStandardMaterial({ color: lin('#f3efe6'), roughness: 0.55, transparent: true, opacity: 0.94 });
      const dark = new T.MeshStandardMaterial({ color: lin('#2b2f33'), roughness: 0.4, metalness: 0.3 });
      const glass = new T.MeshStandardMaterial({ color: lin('#9fd3ff'), roughness: 0.05, metalness: 0.6, emissive: lin('#ffcf8a'), emissiveIntensity: 0 });
      const wood = new T.MeshStandardMaterial({ color: lin('#9a6b43'), roughness: 0.7 });
      const pool = new T.MeshStandardMaterial({ color: lin('#38bde0'), roughness: 0.05, metalness: 0.2, emissive: lin('#1aa6d6'), emissiveIntensity: 0.15 });
      const add = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
      const w = Math.min(width * 0.66, 15), d = Math.min(depth * 0.4, 17);
      add(new T.BoxGeometry(d, 3.2, w), wall, -depth * 0.05, 1.6, 0);
      add(new T.BoxGeometry(d * 0.62, 3, w * 0.7), wall, -depth * 0.05 - d * 0.12, 4.7, -w * 0.12);
      add(new T.BoxGeometry(d * 1.08, 0.3, w * 1.06), dark, -depth * 0.05, 3.3, 0);
      add(new T.BoxGeometry(d * 0.7, 0.3, w * 0.78), dark, -depth * 0.05 - d * 0.12, 6.3, -w * 0.12);
      add(new T.BoxGeometry(0.15, 2.2, w * 0.6), glass, -depth * 0.05 + d / 2 + 0.05, 1.4, w * 0.1);
      add(new T.BoxGeometry(d * 0.45, 0.2, w * 0.5), wood, -depth * 0.05 - d * 0.75, 0.12, w * 0.1);
      add(new T.BoxGeometry(Math.min(depth * 0.16, 8), 0.25, Math.min(width * 0.32, 4)), pool, -depth * 0.05 - d * 0.75, 0.2, -w * 0.25);
      // em terreno inclinado, a casa ganha uma base (arrimo) que desce até o chão
      if (this.dem) add(new T.BoxGeometry(d * 1.02, 8, w * 1.02), new T.MeshStandardMaterial({ color: lin('#b8b2a6'), roughness: 0.9 }), -depth * 0.05, -4, 0);
      this.houseGlass = glass;
      const lines = new T.LineBasicMaterial({ color: 0xc9a45c, transparent: true, opacity: 0.7 });
      g.children.slice(0, 2).forEach((m) => m.add(new T.LineSegments(new T.EdgesGeometry(m.geometry), lines)));
      const dx = long.b[0] - long.a[0], dz = long.b[1] - long.a[1];
      g.rotation.y = -Math.atan2(dz, dx);
      // a frente da casa aponta para fora do miolo da quadra
      const front = new T.Vector3(1, 0, 0).applyEuler(g.rotation);
      const qc = this.qLabels.find((q) => q.el.textContent === 'Q' + e.lot.quadra);
      if (qc && front.dot(new T.Vector3(qc.v.x - e.c[0], 0, qc.v.z - e.c[1])) > 0) g.rotation.y += Math.PI;
      g.position.set(e.c[0], 0, e.c[1]); g.scale.setScalar(0.001);
      g.userData.t0 = this.clock.getElapsedTime();
      this.house = g; this.world.add(g);
    }

    _measures(e) {
      const poly = e.lot.poly; if (poly.length > 8) return;
      LV.geo.edges(poly).forEach((ed) => {
        const el = document.createElement('div'); el.className = 'ml'; el.textContent = LV.fmt.num(ed.len * this.mpu, 1) + ' m';
        this.labels.appendChild(el);
        const [x, z] = this.toW(ed.mid[0], ed.mid[1]);
        this.mLabels.push({ el, gy: this.ground(x, z), v: new T.Vector3(x, 0, z) });
      });
    }

    hover(id) {
      const e = id ? this.byId.get(id) : null;
      if (this.hovered && this.hovered !== this.selected && this.hovered !== e) this.hovered.liftT = 0;
      this.hovered = e;
      if (e && e !== this.selected && !e.isPin) e.liftT = 0.8;
    }

    setMode(m) {
      this.mode = m;
      this.entries.forEach((e) => {
        const avail = e.lot.status === 'disponivel';
        e.hT = m === 'valor' ? (avail ? 1 + e.val * this.S * 0.035 : 0.4) : 0.7;
        e.target = m === 'valor' ? (avail ? valColor(e.val) : lin('#5d6166')) : e.base;
      });
    }

    setFilter(ids) {
      this.filter = ids;
      this.entries.forEach((e) => (e.dimT = ids && !ids.has(e.lot.id) ? 1 : 0));
      if (this.beams) { this.beams.children.forEach((b) => b.geometry.dispose()); this.world.remove(this.beams); this.beams = null; }
      if (!ids || !ids.size || ids.size > 160) return;
      if (!this.beamMat) {
        this.beamMat = new T.ShaderMaterial({
          transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
          uniforms: { t: { value: 0 }, op: { value: 1 }, col: { value: new T.Color('#ffd98a') } },
          vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: 'uniform float t, op; uniform vec3 col; varying float vY; void main(){ float a = pow(1.0 - vY, 2.2) * op; a *= 0.7 + 0.3 * sin(t * 2.5 - vY * 10.0); gl_FragColor = vec4(col, a * 0.75); }'
        });
      }
      this.beams = new T.Group();
      const geo = new T.CylinderGeometry(1, 1, 1, 18, 1, true).translate(0, 0.5, 0);
      ids.forEach((id) => {
        const e = this.byId.get(id); if (!e) return;
        const b = new T.Mesh(geo, this.beamMat);
        const r = clamp(e.size * 0.18, 1.2, this.S * 0.01);
        b.scale.set(r, this.S * 0.16, r); b.position.set(e.c[0], e.gy, e.c[1]); b.renderOrder = 5;
        this.beams.add(b);
      });
      this.world.add(this.beams);
    }

    setHour(h) {
      this.hour = h;
      const S = this.S || 1000;
      const a = ((h - 6) / 12) * Math.PI;
      const el = Math.sin(a);
      const dir = new T.Vector3(Math.cos(a), Math.max(el, -0.3), -0.42).normalize();
      this.sunDir = dir;
      this.sun.position.copy(dir).multiplyScalar(S * 1.8); this.sun.target.position.set(0, 0, 0);
      const day = clamp(el * 2.2 + 0.12, 0, 1); this.day = day;
      const low = clamp(1 - el * 3, 0, 1);
      const warm = new T.Color('#ff9a52'), white = new T.Color('#fff3df');
      this.sun.color.copy(white).lerp(warm, low * 0.8);
      this.sun.intensity = 1.25 * Math.pow(day, 0.8);
      this.sun.castShadow = day > 0.05;
      this.moon.intensity = 0.35 * (1 - day); this.moon.position.set(-S, S, S * 0.5);
      this.hemi.intensity = 0.12 + 0.32 * day;
      this.hemi.color.set(day > 0.5 ? '#cfe6ff' : '#6d7fb0');
      const top = new T.Color('#050913').lerp(new T.Color('#3b7fd0'), day);
      const hor = new T.Color('#0d182b').lerp(new T.Color('#b9d7ee'), day).lerp(new T.Color('#f0985a'), low * day * 0.9);
      if (this.skyMat) {
        this.skyMat.uniforms.top.value.copy(top); this.skyMat.uniforms.hor.value.copy(hor);
        this.skyMat.uniforms.sunDir.value.copy(dir); this.skyMat.uniforms.sunCol.value.copy(this.sun.color).multiplyScalar(day);
      }
      if (this.scene.fog) this.scene.fog.color.copy(hor).convertSRGBToLinear();
      if (this.stars) this.stars.material.opacity = clamp(1 - day * 1.6, 0, 1);
      if (this.clouds) this.clouds.forEach((c) => { c.material.opacity = 0.12 + 0.45 * day; c.material.color.copy(new T.Color('#3a4560').lerp(new T.Color('#ffffff'), day).lerp(warm, low * day * 0.5)); });
      this.renderer.toneMappingExposure = 0.8 + 0.12 * day;
      if (this.beamMat) this.beamMat.uniforms.op.value = 0.55 + 0.45 * (1 - day);
    }

    setTour(on) { this.controls.autoRotate = !!on; }

    /* ------------------------------------------------------------ ponteiro */
    _bindPointer() {
      const dom = this.renderer.domElement;
      let down = null;
      dom.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; if (this.controls.autoRotate && this.hooks.onUserMove) this.hooks.onUserMove(); });
      dom.addEventListener('pointermove', (ev) => { this._ptr = ev; });
      dom.addEventListener('pointerleave', () => { this._ptr = null; this.hover(null); if (this.hooks.onHover) this.hooks.onHover(null); dom.style.cursor = ''; });
      dom.addEventListener('pointerup', (ev) => {
        if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) { down = null; return; }
        down = null;
        const e = this._pick(ev);
        if (this.hooks.onSelect) this.hooks.onSelect(e ? e.lot : null);
      });
    }

    _pick(ev) {
      if (!this.pickables) return null;
      const r = this.renderer.domElement.getBoundingClientRect();
      this.mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      this.ray.setFromCamera(this.mouse, this.camera);
      const hit = this.ray.intersectObjects(this.pickables, false).find((h) => h.object.userData.entry && h.object.userData.entry.dim < 0.5);
      return hit ? hit.object.userData.entry : null;
    }

    /* ------------------------------------------------------------ quadro a quadro */
    tick() {
      const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.getElapsedTime();
      if (!this.world) return;
      if (this.fly) {
        const f = this.fly, k = clamp((t - f.start) / f.dur, 0, 1), s = ease(k);
        this.camera.position.lerpVectors(f.p0, f.p1, s);
        this.controls.target.lerpVectors(f.t0, f.t1, s);
        if (k >= 1) { this.fly = null; this.controls.enabled = true; }
      }
      // limita o alvo da câmera ao terreno
      const tg = this.controls.target;
      tg.x = clamp(tg.x, -this.half[0] * 1.2, this.half[0] * 1.2); tg.z = clamp(tg.z, -this.half[1] * 1.2, this.half[1] * 1.2); tg.y = this.ground(tg.x, tg.z);
      this.controls.update();

      if (this._ptr && !this.fly && t - (this._lastPick || 0) > 0.05) {
        this._lastPick = t;
        const e = this._pick(this._ptr);
        if ((e && e.lot.id) !== (this.hovered && this.hovered.lot.id)) {
          this.hover(e ? e.lot.id : null);
          this.renderer.domElement.style.cursor = e ? 'pointer' : '';
        }
        if (this.hooks.onHover) this.hooks.onHover(e ? e.lot : null, this._ptr.clientX, this._ptr.clientY);
      }

      const k = 1 - Math.pow(0.0015, dt), night = 1 - (this.day == null ? 1 : this.day);
      const intro = this.introStart == null ? 99 : t - this.introStart;
      for (const e of this.entries) {
        if (e.appear < 1) e.appear = clamp((intro - e.delay) / 0.7, 0, 1);
        const ap = e.appear < 1 ? easeBack(e.appear) : 1;
        e.h += (e.hT - e.h) * k; e.lift += (e.liftT - e.lift) * k; e.dim += (e.dimT - e.dim) * k;
        const m = e.mat;
        if (e.target) m.color.lerp(e.target, k);
        const avail = e.lot.status === 'disponivel' && this.mode === 'status';
        const pulse = avail ? 0.5 + 0.5 * Math.sin(t * 2 + e.c[0] * 0.05) : 0;
        let em = 0.06 + night * (avail ? 0.55 + pulse * 0.25 : 0.12);
        if (e === this.hovered) em += 0.35;
        if (e === this.selected) em += 0.4 + 0.25 * Math.sin(t * 4);
        m.emissive.copy(m.color); m.emissiveIntensity = em * (1 - e.dim * 0.85);
        m.opacity = 1 - e.dim * 0.8; m.depthWrite = e.dim < 0.5;
        if (e.isPin) {
          const s = e.size * 0.35 * Math.max(0.001, ap) * (e === this.selected ? 1.35 : e === this.hovered ? 1.15 : 1);
          e.mesh.scale.setScalar(s); e.mesh.position.y = Math.sin(t * 2 + e.c[0]) * e.size * 0.04;
        } else {
          if (e.terrain) { const hh = Math.max(0.02, e.h * ap); if (Math.abs(hh - (e.lastH == null ? -9 : e.lastH)) > 0.004) { this._lotH(e, hh); e.lastH = hh; } }
          else e.mesh.scale.y = Math.max(0.001, e.h * ap);
          e.mesh.position.y = e.lift + (1 - Math.min(1, e.appear * 1.4)) * 6;
          const ed = e.mesh.children[0]; if (ed) ed.material.opacity = (0.25 + 0.2 * night + (e === this.selected ? 0.5 : 0)) * (1 - e.dim * 0.9);
        }
      }
      if (this.house && this.selected) {
        const h = this.house, k2 = clamp((t - h.userData.t0) / 0.9, 0, 1);
        h.scale.setScalar(Math.max(0.001, easeBack(k2)));
        h.position.y = this.selected.gy + this.selected.lift + this.selected.h;
        if (this.houseGlass) this.houseGlass.emissiveIntensity = night * 1.2;
      }
      if (this.ring && this.ring.visible) {
        const u = ((t - this.ring.userData.t0) % 1.6) / 1.6;
        this.ring.scale.setScalar(this.ring.userData.size * (0.6 + u * 1.2));
        this.ring.material.opacity = (1 - u) * 0.9;
      }
      if (this.beamMat) this.beamMat.uniforms.t.value = t;
      if (this.clouds) this.clouds.forEach((c, i) => { c.position.x += dt * (4 + i % 3) * (this.S / 900); if (c.position.x > this.S * 1.6) c.position.x = -this.S * 1.6; });
      if (this.water) this.water.material.roughness = 0.06 + 0.04 * Math.sin(t * 0.7);

      this.renderer.render(this.scene, this.camera);
      this._updateLabels();
      if (this.hooks.onFrame) this.hooks.onFrame(this);
    }

    _updateLabels() {
      if (!this.qLabels) return;
      const w = this.el.clientWidth, h = this.el.clientHeight, v = new T.Vector3();
      const dist = this.camera.position.distanceTo(this.controls.target), S = this.S;
      const place = (el, p, show) => {
        if (!show) { if (el._v !== 0) { el.style.opacity = 0; el.style.pointerEvents = 'none'; el._v = 0; } return; }
        v.copy(p).project(this.camera);
        if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { if (el._v !== 0) { el.style.opacity = 0; el.style.pointerEvents = 'none'; el._v = 0; } return; }
        el.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px) translate(-50%,-50%)';
        if (el._v !== 1) { el.style.opacity = ''; el.style.pointerEvents = ''; el._v = 1; }
      };
      const intro = this.introStart == null || this.clock.getElapsedTime() - this.introStart > 3;
      const showQ = intro && dist < S * 2.2 && dist > S * 0.1;
      if (!showQ) this.qLabels.forEach((q) => place(q.el, q.v, false));
      else {
        const kept = [];
        for (const q of this.qOrder) {
          v.copy(q.v).project(this.camera);
          if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { place(q.el, q.v, false); continue; }
          const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
          let hit = false;
          for (const b of kept) { if (Math.abs(b.x - sx) < 46 && Math.abs(b.y - sy) < 22) { hit = true; break; } }
          place(q.el, q.v, !hit);
          if (!hit) kept.push({ x: sx, y: sy });
        }
      }
      const showL = intro && dist < S * 0.2;
      this.lLabels.forEach((l) => {
        l.v.set(l.e.c[0], l.e.gy + l.e.lift + l.e.h * 1 + 0.4, l.e.c[1]);
        place(l.el, l.v, showL && l.e.dim < 0.5 && l.e !== this.selected);
      });
      this.mLabels.forEach((m) => { m.v.y = (m.gy || 0) + (this.selected ? this.selected.lift + this.selected.h + 0.3 : 0); place(m.el, m.v, true); });
    }

    azimuth() { return this.controls.getAzimuthalAngle(); }

    snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/jpeg', 0.9); }

    destroy() { cancelAnimationFrame(this._raf); this._ro.disconnect(); this.renderer.dispose(); this.el.innerHTML = ''; }
  }

  LV.Scene3D = Scene3D;
})(window.LV);
