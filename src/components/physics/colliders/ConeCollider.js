import { Collider } from './Collider.js';
import { OIMO } from '../../../lib/oimo.js';

export class ConeCollider extends Collider {

	start( data ) {

		data.type = 'cone';
		super.start( data );

	}

	_addDerivedProperties( data ) {

		this._radius = data.radius !== undefined ? data.radius : 0.5;
		this._halfHeight = data.halfHeight !== undefined ? data.halfHeight : 1;

	}

	_setGeometry( scale, max ) {

		return new OIMO.ConeGeometry(
			this._radius * max,
			this._halfHeight * max
		);

	}

	toJSON() {

		const object = super.toJSON();

		object.radius = this._radius;
		object.halfHeight = this._halfHeight;

		return object;

	}

}