import { Component } from "./Component.js";
import { Transform } from "./Engine.js";

class Entity {
	constructor() {
		this.id =
			(+new Date()).toString(16) +
			(Math.random() * 100000000 || 0).toString(16);

		Entity.entities[this.id] = this;
		this.addComponent(Transform);
	}

	addComponent(type, data = {}) {
		const name = type.name;
		const newComponent = new type(this);
		newComponent.entity = this;

		if (!Component.components.hasOwnProperty(name))
			Component.components[name] = [newComponent];
		else Component.components[name].push(newComponent);

		if (typeof newComponent.init === "function") newComponent.init(data);

		if (this.hasOwnProperty(name)) {
			if (Array.isArray(this[name])) this[name].push(newComponent);
			else this[name] = [this[name], newComponent];
		} else this[name] = newComponent;

		return this;
	}

	removeComponent(c) {
		const name = c.name;

		let index = Component.components[name].indexOf(c);
		if (index === -1) throw "Component doesn't exist";
		Component.components[name].splice(index, 1);

		index = this[name].indexOf(c);
		if (index === -1) throw "Component doesn't exist";

		if (Array.isArray(this[name]) && this[name].length > 1)
			this[name].splice(index, 1);
		else delete this[name];

		return this;
	}
}

Entity.entities = {};

export { Entity };
