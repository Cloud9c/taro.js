import * as THREE from "https://threejs.org/build/three.module.js";
import Component from "./Component.js";

const System = {
	init() {
		const cachedConfig = localStorage.getItem("config");
		const cached = cachedConfig !== null;
		const config = cached
			? JSON.parse(cachedConfig)
			: {
					controls: {},
			  };
		this.config = config;
		initMenu(cached, config);

		this.behavior.init();
		this.camera.init();
		this.collision.init();
		this.input.init();
		this.physics.init();
		this.render.init();

		this.lastTimestamp = undefined;
	},
	gameLoop(timestamp) {
		timestamp /= 1000;
		const dt = timestamp - System.lastTimestamp || 0;
		System.lastTimestamp = timestamp;

		// Input always has to be last bc it resets the delta
		System.behavior.update();
		System.physics.update(dt);
		System.collision.update();

		System.camera.update();
		System.render.update();
		System.input.update();

		window.requestAnimationFrame(System.gameLoop);
	},
	animation: {
		init() {
			this.Animation = Component.components.Animation;
		},
		update() {
			for (const entity in this.Animation) {
				this.Animation[entity].mixer.update();
			}
		},
	},
	behavior: {
		init() {
			this.Behavior = Component.components.Behavior;
		},
		update() {
			for (const entity in this.Behavior) {
				this.Behavior[entity]();
			}
		},
	},
	camera: {
		init() {
			const config = System.config;

			let aspectRatio = window.innerWidth / window.innerHeight;
			if (config.aspectRatio != "native") {
				const configRatio = config.aspectRatio.split(":");
				aspectRatio = configRatio[0] / configRatio[1];
			}
			const camera = new THREE.PerspectiveCamera(
				+config.fov,
				aspectRatio,
				1,
				+config.renderDistance
			);
			camera.rotation.order = "YXZ";
			this.perspectiveCamera = camera;
		},
		thirdPersonMode() {
			const camera = this.perspectiveCamera;
			this.firstPerson = false;
			if (!this.renderFirstPerson)
				camera.parent.traverse((node) => {
					if (node.material) {
						node.material.colorWrite = true;
						node.material.depthWrite = true;
					}
				});
			camera.position.set(-2, 10, -15);
			camera.rotation.set((-160 * Math.PI) / 180, 0, Math.PI);
			this.cameraRadius = Math.sqrt(
				camera.position.z * camera.position.z +
					camera.position.y * camera.position.y
			);
			this.cameraArc = Math.acos(-camera.position.z / this.cameraRadius);
			camera.zoom = 1.65;
		},
		firstPersonMode() {
			const camera = this.perspectiveCamera;
			this.firstPerson = true;
			if (!this.renderFirstPerson)
				camera.parent.traverse((node) => {
					if (node.material) {
						node.material.colorWrite = false;
						node.material.depthWrite = false;
					}
				});
			camera.position.set(0, 4, 0);
			camera.rotation.set(0, Math.PI, 0);
			camera.zoom = 1;
		},
		addTarget(target, firstPerson = true, renderFirstPerson = false) {
			target.add(this.perspectiveCamera);

			this.renderFirstPerson = renderFirstPerson;

			if (firstPerson) this.firstPersonMode();
			else this.thirdPersonMode();
		},
		update() {
			const camera = this.perspectiveCamera;
			const keyInput = System.input.keyInput;

			if (keyInput.MouseX != 0) {
				// temp solution
				camera.parent.rotation.y -= keyInput.MouseX;
			}

			if (keyInput.MouseY != 0) {
				if (this.firstPerson) {
					const newX = camera.rotation.x - keyInput.MouseY;
					if (newX < 1.5 && newX > -1.5) camera.rotation.x = newX;
				} else {
					const newCameraArc = this.cameraArc + keyInput.MouseY;
					if (newCameraArc < 1.1 && newCameraArc > 0.1) {
						const newX = camera.rotation.x + keyInput.MouseY;
						this.cameraArc = newCameraArc;
						camera.position.z =
							-Math.cos(newCameraArc) * this.cameraRadius;
						camera.position.y =
							Math.sin(newCameraArc) * this.cameraRadius;
						camera.rotation.x = newX;
					}
				}
			}

			if (keyInput.WheelY != 0) {
				if (keyInput.WheelY < 0) {
					camera.zoom = Math.max(camera.zoom - 0.05, 1);
					if (this.firstPerson) {
						this.thirdPersonMode();
					}
				} else {
					const newZoom = camera.zoom + 0.05;
					if (!this.firstPerson) {
						if (camera.zoom >= 1.65) {
							this.firstPersonMode();
						} else {
							camera.zoom = Math.min(newZoom, 1.65);
						}
					}
				}
				camera.updateProjectionMatrix();
			}
		},
	},
	collision: {
		init() {
			this.Collider = Component.components.Collider;
		},
		edgeInEdges(edges, edge) {
			for (let i = 0, len = edges.length; i < len; i++)
				if (edges[i].a == edge.a && edges[i].b == edge.b) return i;

			return -1;
		},
		EPA(vertA, vertB, simplex, supportList) {
			const simplexFaces = [
				{
					a: 0,
					b: 1,
					c: 2,
				},
				{
					a: 0,
					b: 1,
					c: 3,
				},
				{
					a: 0,
					b: 2,
					c: 3,
				},
				{
					a: 1,
					b: 2,
					c: 3,
				},
			];
			const epsilon = 0.00001; // Maybe too small?
			while (true) {
				const face = this.findClosestFace(simplex, simplexFaces);
				const point = this.support(vertA, vertB, face.normal);
				const dist = point[0].dot(face.normal);

				if (dist - face.dist < epsilon) {
					return {
						dist: dist,
						point: this.getContactPoint(
							face.normal.clone().negate().multiplyScalar(dist),
							face.a,
							face.b,
							face.c
						),
						normal: face.normal,
					};
				}

				simplex.push(point);
				this.expand(simplex, simplexFaces, point[0]);
			}
		},
		evaluateAndChangeDir(simplex, dir) {
			let ab, ac, ad, a0, ba, bc, bd, b0;
			switch (simplex.length) {
				case 2:
					ab = simplex[1][0].clone().sub(simplex[0][0]);
					a0 = simplex[0][0].clone().negate();
					dir.copy(ab.clone().cross(a0).cross(ab));

					return false;
				case 3:
					ab = simplex[1][0].clone().sub(simplex[0][0]);
					ac = simplex[2][0].clone().sub(simplex[0][0]);
					dir.copy(ab.cross(ac));

					a0 = simplex[0][0].clone().negate();
					if (a0.dot(dir) < 0) dir.negate();

					return false;
				case 4:
					//face abc
					ab = simplex[1][0].clone().sub(simplex[0][0]);
					ac = simplex[2][0].clone().sub(simplex[0][0]);
					dir.copy(ab.cross(ac).normalize());

					ad = simplex[3][0].clone().sub(simplex[0][0]);
					if (ad.dot(dir) > 0) {
						dir.negate();
					}

					a0 = simplex[0][0].clone().negate();
					if (a0.dot(dir) > 0) {
						//remove d
						simplex.splice(3, 1);
						return false;
					}

					//face abd
					ab = simplex[1][0].clone().sub(simplex[0][0]);
					ad = simplex[3][0].clone().sub(simplex[0][0]);
					dir.copy(ab.cross(ad).normalize());

					ac = simplex[2][0].clone().sub(simplex[0][0]);
					if (ac.dot(dir) > 0) {
						dir.negate();
					}

					a0 = simplex[0][0].clone().negate();
					if (a0.dot(dir) > 0) {
						//remove c
						simplex.splice(2, 1);
						return false;
					}

					//face acd
					ac = simplex[2][0].clone().sub(simplex[0][0]);
					ad = simplex[3][0].clone().sub(simplex[0][0]);
					dir.copy(ac.cross(ad).normalize());

					ab = simplex[1][0].clone().sub(simplex[0][0]);
					if (ab.dot(dir) > 0) {
						dir.negate();
					}

					a0 = simplex[0][0].clone().negate();
					if (a0.dot(dir) > 0) {
						//remove b
						simplex.splice(1, 1);
						return false;
					}

					//face bcd
					bc = simplex[2][0].clone().sub(simplex[1][0]);
					bd = simplex[3][0].clone().sub(simplex[1][0]);
					dir.copy(bc.cross(bd).normalize());

					ba = simplex[0][0].clone().sub(simplex[1][0]);
					if (ba.dot(dir) > 0) {
						dir.negate();
					}

					b0 = simplex[1][0].clone().negate();
					if (b0.dot(dir) > 0) {
						//remove a
						simplex.splice(0, 1);
						return false;
					}

					//origin is in center
					return true;
			}
		},
		expand(simplex, simplexFaces, extendPoint) {
			//def can make all this more efficient
			const removalFaces = [];
			for (let i = 0, len = simplexFaces.length; i < len; i++) {
				const face = simplexFaces[i];

				const ab = simplex[face.b][0].clone().sub(simplex[face.a][0]);
				const ac = simplex[face.c][0].clone().sub(simplex[face.a][0]);
				const norm = ab.cross(ac).normalize();

				const a0 = new THREE.Vector3().sub(simplex[face.a][0]);
				if (a0.dot(norm) > 0) norm.negate();

				if (norm.dot(extendPoint.clone().sub(simplex[face.a][0])) > 0)
					removalFaces.push(i);
			}

			const edges = [];
			const removalFacesLen = removalFaces.length;
			for (let i = 0; i < removalFacesLen; i++) {
				const face = simplexFaces[removalFaces[i]];
				const edgeAB = {
					a: face.a,
					b: face.b,
				};
				const edgeAC = {
					a: face.a,
					b: face.c,
				};
				const edgeBC = {
					a: face.b,
					b: face.c,
				};

				let k = this.edgeInEdges(edges, edgeAB);
				if (k != -1) edges.splice(k, 1);
				else edges.push(edgeAB);

				k = this.edgeInEdges(edges, edgeAC);
				if (k != -1) edges.splice(k, 1);
				else edges.push(edgeAC);

				k = this.edgeInEdges(edges, edgeBC);
				if (k != -1) edges.splice(k, 1);
				else edges.push(edgeBC);
			}

			for (let i = removalFacesLen - 1; i >= 0; i--) {
				simplexFaces.splice(removalFaces[i], 1);
			}

			for (let i = 0, len = edges.length; i < len; i++) {
				simplexFaces.push({
					a: edges[i].a,
					b: edges[i].b,
					c: simplex.length - 1,
				});
			}
		},
		findClosestFace(simplex, simplexFaces) {
			let closest = {
				dist: Infinity,
			};

			for (let i = 0, len = simplexFaces.length; i < len; i++) {
				const face = simplexFaces[i];
				const ab = simplex[face.b][0].clone().sub(simplex[face.a][0]);
				const ac = simplex[face.c][0].clone().sub(simplex[face.a][0]);
				const normal = ab.cross(ac).normalize();
				const a0 = new THREE.Vector3().sub(simplex[face.a][0]);
				if (a0.dot(normal) > 0) normal.negate();

				const dist = simplex[face.a][0].dot(normal);
				if (dist < closest.dist)
					closest = {
						index: i,
						dist: dist,
						normal: normal,
						a: simplex[face.a],
						b: simplex[face.b],
						c: simplex[face.c],
					};
			}
			return closest;
		},
		getContactPoint(p, a, b, c) {
			const v0 = b[0].clone().sub(a[0]),
				v1 = c[0].clone().sub(a[0]),
				v2 = p.clone().sub(a[0]),
				d00 = v0.dot(v0),
				d01 = v0.dot(v1),
				d11 = v1.dot(v1),
				d20 = v2.dot(v0),
				d21 = v2.dot(v1),
				denom = d00 * d11 - d01 * d01,
				v = (d11 * d20 - d01 * d21) / denom,
				w = (d00 * d21 - d01 * d20) / denom,
				u = 1 - v - w;

			return a[1]
				.clone()
				.multiplyScalar(u)
				.add(b[1].clone().multiplyScalar(v))
				.add(c[1].clone().multiplyScalar(w));
		},
		getFurthestPointInDirection(verts, dir) {
			let index = 0;
			let maxDot = -Infinity;

			for (let i = 0; i < verts.length; i++) {
				const dot = verts[i].dot(dir);

				if (dot > maxDot) {
					maxDot = dot;
					index = i;
				}
			}

			return verts[index];
		},
		GJK(colA, colB, dir) {
			const simplex = [];
			const vertA = colA.worldVertices;
			const vertB = colB.worldVertices;

			const p = this.support(vertA, vertB, dir);
			simplex.push(p);

			dir.negate();

			while (true) {
				const p = this.support(vertA, vertB, dir);
				simplex.push(p);

				if (p[0].dot(dir) <= 0) return;

				if (this.evaluateAndChangeDir(simplex, dir)) {
					// TODO add to collision linked list
					const isMovingA = colA.hasOwnProperty("Physics");
					const isMovingB = colB.hasOwnProperty("Physics");
					const contact = this.EPA(vertA, vertB, simplex);
					const mat = {
						bounciness:
							(colA.material.bounciness +
								colB.material.bounciness) /
							2,
						staticFriction:
							(colA.material.staticFriction +
								colB.material.staticFriction) /
							2,
						dynamicFriction:
							(colA.material.dynamicFriction +
								colB.material.dynamicFriction) /
							2,
					};
					if (isMovingA && isMovingB)
						this.resolveCollision(colA, colB, contact, mat);
					else if (isMovingA) {
						contact.normal.negate();
						this.reflectCollision(colA, contact, mat);
					} else if (isMovingB) {
						this.reflectCollision(colB, contact, mat);
					}
					return;
				}
			}
		},
		reflectCollision(movable, contact, mat) {
			const phys = movable.Physics;

			const i = new THREE.Vector3(
				1 / phys.inertiaTensor.x,
				1 / phys.inertiaTensor.y,
				1 / phys.inertiaTensor.z
			);
			const r = phys.worldCenterOfMass.sub(contact.point);

			const j = contact.normal.clone().multiplyScalar(
				phys
					.getPointVelocity(contact.point)
					.multiplyScalar(-1 - mat.bounciness)
					.dot(contact.normal) /
					(1 / phys.mass +
						i
							.clone()
							.multiply(r.clone().cross(contact.normal))
							.cross(r.clone())
							.dot(contact.normal))
			);

			phys.velocity.add(
				contact.normal.clone().multiply(j).divideScalar(phys.mass)
			);
			phys.angularVelocity.add(
				i.multiply(j).multiply(r.cross(contact.normal))
			);
		},
		resolveCollision(colA, colB, contact, mat) {
			const physA = colA.Physics;
			const physB = colB.Physics;
			const v = physB
				.getPointVelocity(contact.point)
				.sub(physA.getPointVelocity(contact.point));
			const iA = new THREE.Vector3(
				1 / physA.inertiaTensor.x,
				1 / physA.inertiaTensor.y,
				1 / physA.inertiaTensor.z
			);
			const iB = new THREE.Vector3(
				1 / physB.inertiaTensor.x,
				1 / physB.inertiaTensor.y,
				1 / physB.inertiaTensor.z
			);
			const rA = physA.worldCenterOfMass.sub(contact.point);
			const rB = physB.worldCenterOfMass.sub(contact.point);
			const j = contact.normal.clone().multiplyScalar(
				v.multiplyScalar(-1 - mat.bounciness).dot(contact.normal) /
					(1 / physA.mass +
						1 / physB.mass +
						contact.normal.clone().dot(
							iA
								.clone()
								.multiply(rA.clone().cross(contact.normal))
								.cross(rA)
								.add(
									iB
										.clone()
										.multiply(
											rB.clone().cross(contact.normal)
										)
										.cross(rB)
								)
						))
			);
			console.log(j);
			physA.velocity.sub(
				contact.normal.clone().multiply(j).divideScalar(physA.mass)
			);
			physB.velocity.add(
				contact.normal.clone().multiply(j).divideScalar(physB.mass)
			);
			physA.angularVelocity.sub(
				iA.multiply(j).multiply(rA.cross(contact.normal))
			);
			physB.angularVelocity.add(
				iB.multiply(j).multiply(rB.cross(contact.normal))
			);
		},
		support(aVerts, bVerts, dir) {
			const a = this.getFurthestPointInDirection(aVerts, dir);
			const diff = a
				.clone()
				.sub(
					this.getFurthestPointInDirection(
						bVerts,
						dir.clone().negate()
					)
				);
			return [diff, a];
		},
		update() {
			const Collider = this.Collider;
			// update box3
			const colliders = Object.values(Collider);
			const len = colliders.length;

			for (let i = 0; i < len; i++) {
				for (let j = i + 1; j < len; j++) {
					const colA = colliders[i];
					const colB = colliders[j];
					// broad phase (NEED TO ADD SPATIAL INDEX) TODO
					if (colA.worldAABB.intersectsBox(colB.worldAABB)) {
						// collision detection and response
						this.GJK(
							colA,
							colB,
							colA.worldCentroid.clone().sub(colB.worldCentroid)
						);
					}
				}
			}
		},
	},
	input: {
		init() {
			const config = System.config;
			this.sensitivityX = config.mouseSensitivity / 1400;
			this.sensitivityY = config.mouseSensitivity / 1400;
			if (config.mouseInvert === "true") this.sensitivityY *= -1;

			const keyInput = {
				MouseX: 0,
				MouseY: 0,
				WheelX: 0,
				WheelY: 0,
			};

			for (const control in System.config.controls) {
				keyInput[control] = () => {
					return keyInput[System.config.controls[control]] || false;
				};
			}

			document.getElementById("c").addEventListener("click", () => {
				if (config.displayMode === "fullscreen")
					document.body.requestFullscreen();
				document.body.requestPointerLock();
			});

			window.addEventListener("blur", () => {
				for (const property in keyInput) {
					if (typeof keyInput[property] === "boolean")
						keyInput[property] = false;
					else if (typeof keyInput[property] === "number")
						keyInput[property] = 0;
				}
				System.lastTimestamp = undefined;
			});

			window.addEventListener("resize", () => {
				System.camera.perspectiveCamera.aspect =
					window.innerWidth / window.innerHeight;
				System.camera.perspectiveCamera.updateProjectionMatrix();
				System.render.renderer.setSize(
					window.innerWidth,
					window.innerHeight
				);
			});

			document
				.getElementById("setting-back")
				.addEventListener("click", () => {
					document.getElementById("menu").style.display = "none";
					if (config.displayMode === "fullscreen")
						document.body.requestFullscreen();
					document.body.requestPointerLock();
				});

			window.addEventListener("beforeunload", (event) => {
				event.preventDefault();
				localStorage.setItem("config", JSON.stringify(System.config));
				event.returnValue = "";
			});

			const onMouseMove = (event) => {
				keyInput.MouseX = event.movementX * this.sensitivityX;
				keyInput.MouseY = event.movementY * this.sensitivityY;
			};

			const onWheel = () => {
				keyInput.WheelX = event.wheelDeltaX;
				keyInput.WheelY = event.wheelDeltaY;
			};

			const onKeyDown = () => {
				if (event.repeat) return;

				keyInput[event.code] = true;

				if (event.code === "Tab") {
					enterMenu();
					document.getElementById("menu").style.display = "";
					document.exitPointerLock();
				}
			};

			const onMenuKeyDown = () => {
				if (event.code === "Tab") {
					document.getElementById("menu").style.display = "none";
					exitMenu();
					if (config.displayMode === "fullscreen")
						document.body.requestFullscreen();
					document.body.requestPointerLock();
				}
			};

			const onKeyUp = () => {
				keyInput[event.code] = false;
			};

			const exitMenu = () => {
				document.removeEventListener("keydown", onMenuKeyDown);
				document.addEventListener("mousemove", onMouseMove);
				document.addEventListener("wheel", onWheel);
				document.addEventListener("keydown", onKeyDown);
				document.addEventListener("keyup", onKeyUp);
			};

			const enterMenu = () => {
				document.addEventListener("keydown", onMenuKeyDown);
				document.removeEventListener("mousemove", onMouseMove);
				document.removeEventListener("wheel", onWheel);
				document.removeEventListener("keydown", onKeyDown);
				document.removeEventListener("keyup", onKeyUp);
			};

			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("wheel", onWheel);
			document.addEventListener("keydown", onKeyDown);
			document.addEventListener("keyup", onKeyUp);

			this.keyInput = keyInput;
		},
		update() {
			const keyInput = this.keyInput;
			keyInput.MouseX = 0;
			keyInput.MouseY = 0;
			keyInput.WheelX = 0;
			keyInput.WheelY = 0;
		},
	},
	physics: {
		init() {
			this.Physics = Component.components.Physics;
			this.Transform = Component.components.Transform;
			this.Object3D = Component.components.Object3D;
			this.gravity = new THREE.Vector3(0, -9.8, 0);
		},
		update(dt) {
			for (const entity in this.Physics) {
				const physics = this.Physics[entity];
				const transform = this.Transform[entity];

				if (physics.useGravity)
					physics.velocity.add(
						this.gravity.clone().multiplyScalar(dt)
					);
				transform.position.add(
					physics.velocity.clone().multiplyScalar(dt)
				);

				const angularDelta = physics.angularVelocity
					.clone()
					.multiplyScalar(dt);
				transform.rotation.x += angularDelta.x;
				transform.rotation.y += angularDelta.y;
				transform.rotation.z += angularDelta.z;
			}
		},
	},
	render: {
		init() {
			const config = System.config;

			document.getElementById("c").style.filter =
				"brightness(" + (+config.brightness + 50) / 100 + ")";

			if (config.displayMode === "fullscreen") {
				document.body.requestFullscreen();
			}

			const renderer = new THREE.WebGLRenderer({
				canvas: document.getElementById("c"),
				precision: config.shadowPrecision,
				antialias: config.antiAliasing === "true",
				powerPreference: config.powerPreference,
			});
			renderer.setSize(window.innerWidth, window.innerHeight);
			renderer.shadowMap.enabled = true;
			renderer.shadowMap.type = THREE[config.shadowMap];
			renderer.physicallyCorrectLights =
				config.physicallyCorrectLights === "true";
			renderer.toneMapping = THREE[config.toneMap];

			renderer.setPixelRatio(+config.resolution);
			this.renderer = renderer;

			const maxFiltering = renderer.capabilities.getMaxAnisotropy();
			const filterLevels = document.querySelector(
				"select[name=textureFiltering]"
			).children;
			for (let i = filterLevels.length - 1; i >= 0; i--) {
				const element = filterLevels[i];
				if (element.value > maxFiltering) {
					element.remove();
				}
			}

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x0080ff);
			this.scene = scene;
			this.camera = System.camera.perspectiveCamera;
		},
		update() {
			this.renderer.render(this.scene, this.camera);
		},
	},
};

function initMenu(cached, config) {
	function applyChanges(name) {
		const config = System.config;
		switch (name) {
			case "mouseSensitivity":
				System.input.sensitivityX = config.mouseSensitivity / 1400;
				System.input.sensitivityY = config.mouseSensitivity / 1400;
				break;
			case "mouseInvert":
				if (config.mouseInvert === "true")
					System.input.sensitivityY *= -1;
				break;
			case "resolution":
				System.render.renderer.setPixelRatio(+config.resolution);
				break;
			case "brightness":
				document.getElementById("c").style.filter =
					"brightness(" + (+config.brightness + 50) / 100 + ")";
				break;
			case "fov":
				System.camera.perspectiveCamera.fov = +config.fov;
				break;
			case "aspectRatio":
				let aspectRatio = window.innerWidth / window.innerHeight;
				if (config.aspectRatio != "native") {
					const configRatio = config.aspectRatio.split(":");
					aspectRatio = configRatio[0] / configRatio[1];
				}
				System.camera.perspectiveCamera.aspect = aspectRatio;
				break;
			case "renderDistance":
				System.camera.perspectiveCamera.far = +config.renderDistance;
				break;
		}
		System.camera.perspectiveCamera.updateProjectionMatrix();
	}

	function rangeOnInput() {
		const percent =
			(100 * (this.value - this.getAttribute("min"))) /
			(this.getAttribute("max") - this.getAttribute("min"));
		this.style.background =
			"linear-gradient(to right, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.8) " +
			percent +
			"%, rgba(255,255,255,0.4) " +
			percent +
			"%, rgba(255,255,255,0.4) 100%)";
		this.nextElementSibling.value = this.value;
		config[this.name] = this.value;
		applyChanges(this.name);
	}

	function textOnKeydown() {
		const key = event.code;

		if (key === "Tab") return;

		const controls = document.querySelectorAll("input[type=text]");
		for (const control of controls) {
			if (control.value === key) {
				config.controls[control.name] = control.value = "";
			}
		}
		config.controls[this.name] = this.value = key;
		this.blur();
	}

	function textOnClick() {
		System.input.controls[this.name] = config.controls[
			this.name
		] = this.value = "";
	}

	function onInput() {
		config[this.name] = this.value;
		applyChanges(this.name);
	}

	for (const element of document.getElementById("menu-sidebar").children) {
		element.addEventListener("click", () => {
			document
				.querySelector(".setting-label[data-selected]")
				.removeAttribute("data-selected");
			document
				.querySelector(".setting[data-selected]")
				.removeAttribute("data-selected");
			element.setAttribute("data-selected", "");
			document
				.querySelector(
					".setting[data-setting=" +
						element.getAttribute("data-setting") +
						"]"
				)
				.setAttribute("data-selected", "");
		});
	}

	for (const element of document.querySelectorAll(
		".setting input:not([type=number]), .setting select"
	)) {
		if (element.type === "text") {
			if (!(cached || config.controls.hasOwnProperty(element.name)))
				config.controls[element.name] = element.getAttribute(
					"data-default"
				);
			else element.value = config.controls[element.name];
		} else {
			if (!(cached || config.hasOwnProperty(element.name)))
				config[element.name] = element.getAttribute("data-default");
			else element.value = config[element.name];
		}

		switch (element.type) {
			case "range":
				const percent =
					(100 * (element.value - element.getAttribute("min"))) /
					(element.getAttribute("max") - element.getAttribute("min"));
				element.style.background =
					"linear-gradient(to right, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.8) " +
					percent +
					"%, rgba(255,255,255,0.4) " +
					percent +
					"%, rgba(255,255,255,0.4) 100%)";
				element.nextElementSibling.value = element.value;
				element.addEventListener("input", rangeOnInput);
				break;
			case "text":
				element.addEventListener("keydown", textOnKeydown);
				element.nextElementSibling.addEventListener(
					"click",
					textOnClick
				);
				break;
			default:
				element.addEventListener("input", onInput);
		}
	}

	document
		.getElementById("restore-defaults")
		.addEventListener("click", () => {
			for (const element of document.querySelectorAll(
				".setting[data-selected] input:not([type=number]), .setting select"
			)) {
				const dataDefault = element.getAttribute("data-default");

				if (element.type === "range") {
					const percent =
						(100 * (dataDefault - element.getAttribute("min"))) /
						(element.getAttribute("max") -
							element.getAttribute("min"));
					element.style.background =
						"linear-gradient(to right, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.8) " +
						percent +
						"%, rgba(255,255,255,0.4) " +
						percent +
						"%, rgba(255,255,255,0.4) 100%)";
					element.nextElementSibling.value = dataDefault;
				}

				element.value = dataDefault;
				if (element.type === "text")
					config.controls[element.name] = dataDefault;
				else config[element.name] = dataDefault;
				applyChanges(element.name);
			}
		});
}

export default System;
