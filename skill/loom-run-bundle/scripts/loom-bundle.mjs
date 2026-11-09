#!/usr/bin/env node
import { constants as e, realpathSync as t } from "node:fs";
import { basename as n, dirname as r, isAbsolute as i, join as a, relative as o, resolve as s, sep as c } from "node:path";
import { fileURLToPath as l } from "node:url";
import { createHash as u, randomUUID as d } from "node:crypto";
import { chmod as f, link as p, lstat as m, mkdir as h, open as g, opendir as _, readFile as v, realpath as y, rename as ee, rm as b, stat as x, unlink as te } from "node:fs/promises";
import { DatabaseSync as ne } from "node:sqlite";
// node_modules/zod/v4/core/util.js
function re(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return Object.entries(e).filter(([e, n]) => t.indexOf(+e) === -1).map(([e, t]) => t);
}
function ie(e, t = "|") {
	return e.map((e) => Oe(e)).join(t);
}
function ae(e, t) {
	return typeof t == "bigint" ? t.toString() : t;
}
var oe = class {
	constructor(e) {
		this._getter = e, this._value = void 0;
	}
	get value() {
		let e = this._getter;
		return e !== void 0 && (this._value = e(), this._getter = void 0), this._value;
	}
};
function se(e) {
	return new oe(e);
}
function ce(e) {
	return e == null;
}
function le(e) {
	let t = +!!e.startsWith("^"), n = e.endsWith("$") ? e.length - 1 : e.length;
	return e.slice(t, n);
}
function ue(e, t) {
	let n = e / t, r = Math.round(n), i = 4 * 2 ** -52 * Math.max(Math.abs(n), 1);
	return Math.abs(n - r) < i ? 0 : n - r;
}
function de(e, t, n) {
	Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
}
function fe(e) {
	let t = Object.getOwnPropertyDescriptor(e, "shape");
	return t?.get ? t.get.raw : t?.value;
}
function pe(e) {
	return fe(e._zod.def) ?? e._zod.def.shape;
}
function me(e, t, n) {
	Object.defineProperty(e, t, {
		get() {
			let e = n();
			return de(this, t, e), e;
		},
		enumerable: !0,
		configurable: !0
	});
}
function he(e, t, n) {
	t in e ? de(e, t, n) : e[t] = n;
}
function ge(e, t, n, r) {
	let i = pe(t);
	for (let a of n) {
		let n = Object.getOwnPropertyDescriptor(i, a);
		n.enumerable && (n.get ? me(e, a, () => {
			let e = t._zod.def.shape[a];
			return r ? r(e, a) : e;
		}) : he(e, a, r ? r(n.value, a) : n.value));
	}
}
function _e(e, t) {
	for (let n of Reflect.ownKeys(t)) {
		let r = Object.getOwnPropertyDescriptor(t, n);
		r.enumerable && (r.get ? me(e, n, () => t[n]) : he(e, n, r.value));
	}
}
function S(...e) {
	let t = {};
	for (let n of e) {
		let e = Object.getOwnPropertyDescriptors(n);
		Object.assign(t, e);
	}
	return Object.defineProperties({}, t);
}
function ve(e) {
	return JSON.stringify(e);
}
function ye(e) {
	return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var be = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {};
function xe(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var Se = /* @__PURE__*/ se(() => {
	if (_t.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
	try {
		return Function(""), !0;
	} catch {
		return !1;
	}
});
function Ce(e) {
	if (xe(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0 || typeof t != "function") return !0;
	let n = t.prototype;
	return xe(n) !== !1 && Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") !== !1;
}
function we(e) {
	return Ce(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
var Te = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function Ee(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function De(e, t, n) {
	let r = new e._zod.constr(t ?? e._zod.def);
	return (!t || n?.parent) && (r._zod.parent = e), r;
}
function C(e) {
	let t = e;
	if (!t) return {};
	if (typeof t == "string") return { error: () => t };
	if (t?.message !== void 0) {
		if (t?.error !== void 0) throw Error("Cannot specify both `message` and `error` params");
		t.error = t.message;
	}
	return delete t.message, typeof t.error == "string" ? {
		...t,
		error: () => t.error
	} : t;
}
function Oe(e) {
	return typeof e == "bigint" ? e.toString() + "n" : typeof e == "string" ? `"${e}"` : `${e}`;
}
function ke(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin !== void 0 && e[t]._zod.optout === "optional");
}
var Ae = {
	safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}, je = {
	int64: [/* @__PURE__*/ BigInt("-9223372036854775808"), /* @__PURE__*/ BigInt("9223372036854775807")],
	uint64: [/* @__PURE__*/ BigInt(0), /* @__PURE__*/ BigInt("18446744073709551615")]
};
function Me(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".pick() cannot be used on object schemas containing refinements");
	let i = {};
	return ge(i, e, Ne(e, t)), De(e, S(n, {
		shape: i,
		checks: []
	}));
}
function Ne(e, t) {
	let n = pe(e), r = [];
	for (let e of Reflect.ownKeys(t)) {
		if (!Object.getOwnPropertyDescriptor(n, e)?.enumerable) throw Error(`Unrecognized key: "${String(e)}"`);
		t[e] && r.push(e);
	}
	return r;
}
function Pe(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".omit() cannot be used on object schemas containing refinements");
	let i = new Set(Ne(e, t)), a = {};
	return ge(a, e, Reflect.ownKeys(pe(e)).filter((e) => !i.has(e))), De(e, S(n, {
		shape: a,
		checks: []
	}));
}
function Fe(e, t) {
	if (!Ce(t)) throw Error("Invalid input to extend: expected a plain object");
	let n = e._zod.def.checks;
	if (n && n.length > 0) {
		let n = pe(e);
		for (let e of Reflect.ownKeys(t)) if (Object.getOwnPropertyDescriptor(n, e) !== void 0) throw Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return De(e, S(e._zod.def, { shape: Ie(e, t) }));
}
function Ie(e, t) {
	let n = {};
	return ge(n, e, Reflect.ownKeys(pe(e))), _e(n, t), n;
}
function Le(e, t) {
	if (!Ce(t)) throw Error("Invalid input to safeExtend: expected a plain object");
	return De(e, S(e._zod.def, { shape: Ie(e, t) }));
}
function Re(e, t) {
	if (!t?._zod?.def) throw Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
	if (e._zod.def.checks?.length) throw Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	let n = {};
	return ge(n, e, Reflect.ownKeys(pe(e))), ge(n, t, Reflect.ownKeys(pe(t))), De(e, S(e._zod.def, {
		shape: n,
		get catchall() {
			return t._zod.def.catchall;
		},
		checks: t._zod.def.checks ?? []
	}));
}
function ze(e, t, n, r = "partial") {
	let i = t._zod.def.checks;
	if (i && i.length > 0) throw Error(`.${r}() cannot be used on object schemas containing refinements`);
	let a = n ? new Set(Ne(t, n)) : void 0, o = {};
	return ge(o, t, Reflect.ownKeys(pe(t)), e && ((t, n) => a && !a.has(n) ? t : new e({
		type: "optional",
		innerType: t
	}))), De(t, S(t._zod.def, {
		shape: o,
		checks: []
	}));
}
function Be(e, t, n) {
	let r = n ? new Set(Ne(t, n)) : void 0, i = {};
	return ge(i, t, Reflect.ownKeys(pe(t)), (t, n) => r && !r.has(n) ? t : new e({
		type: "nonoptional",
		innerType: t
	})), De(t, S(t._zod.def, { shape: i }));
}
function Ve(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
	return !1;
}
function He(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
	return !1;
}
function Ue(e, t) {
	return t.map((t) => {
		var n;
		return (n = t).path ?? (n.path = []), t.path.unshift(e), t;
	});
}
function We(e) {
	return typeof e == "string" ? e : e?.message;
}
function Ge(e) {
	let t = [];
	for (let n of e ?? []) {
		let e = n._zod.def;
		if (!/_(length|size)$|_equals$/.test(e.check)) break;
		let r = e.maximum ?? e.length ?? e.size;
		r >= 0 && t.push([r, n]);
	}
	return t;
}
function Ke(e, t, n) {
	var r;
	for (let i = t; i < e.length; i++) (r = e[i]).schema ?? (r.schema = n);
}
function qe(e, t, n) {
	var r;
	let i = e.inst?._zod?.traits;
	i?.has("$ZodType") && (i.has("$ZodCheck") ? (r = e).schema ?? (r.schema = e.inst) : e.schema = e.inst);
	let a = e.schema === e.inst ? void 0 : e.schema?._zod.def?.error, o = e.message ? e.message : We(e.inst?._zod.def?.error?.(e)) ?? We(a?.(e)) ?? We(t?.error?.(e)) ?? We(n.customError?.(e)) ?? We(n.localeError?.(e)) ?? "Invalid input", s = {};
	for (let t of Object.keys(e)) t !== "inst" && t !== "schema" && t !== "continue" && t !== "input" && t !== "__proto__" && (s[t] = e[t]);
	return s.path ??= [], s.message = o, t?.reportInput && (s.input = e.input), s;
}
var Je = /[\uD800-\uDBFF]/;
function Ye(e) {
	let t = e.length;
	if (!Je.test(e)) return t;
	let n = t;
	for (let r = 0; r < t - 1; r++) (e.charCodeAt(r) & 64512) == 55296 && (e.charCodeAt(r + 1) & 64512) == 56320 && (n--, r++);
	return n;
}
function Xe(e) {
	return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function Ze(e) {
	let t = typeof e;
	switch (t) {
		case "number": return Number.isNaN(e) ? "nan" : "number";
		case "object": {
			if (e === null) return "null";
			if (Array.isArray(e)) return "array";
			let t = e;
			if (t && Object.getPrototypeOf(t) !== Object.prototype && "constructor" in t && t.constructor) return t.constructor.name;
		}
	}
	return t;
}
function Qe(...e) {
	let [t, n, r] = e;
	return typeof t == "string" ? {
		message: t,
		code: "custom",
		input: n,
		inst: r
	} : { ...t };
}
function $e(e, t) {
	for (let n in t) {
		let r = Object.getOwnPropertyDescriptor(t, n);
		r.get ? Object.defineProperty(e, n, {
			...r,
			enumerable: !1
		}) : rt(e, n, r.value);
	}
}
function et(e, t, n, r = !0) {
	return Object.defineProperty(e, t, {
		configurable: !0,
		writable: !0,
		enumerable: r,
		value: n
	}), n;
}
function tt(e, t, n) {
	return et(e, t, n, !1);
}
/* @__NO_SIDE_EFFECTS__ */
function nt(e, t) {
	for (let n in e) {
		let r = e[n];
		Object.defineProperty(t, n, {
			configurable: !0,
			enumerable: !0,
			get() {
				return et(this, n, r(this));
			},
			set(e) {
				et(this, n, e);
			}
		});
	}
	return t;
}
function rt(e, t, n) {
	Object.defineProperty(e, t, {
		configurable: !0,
		get() {
			return this == null ? n : et(this, t, n.bind(this));
		},
		set(e) {
			et(this, t, e);
		}
	});
}
function it(e, t) {
	let n = Object.getPrototypeOf(e);
	return t in n ? void 0 : n;
}
var at, ot = !1, st = {
	configurable: !0,
	get() {
		ot = !0;
	}
};
function w(e, t, n) {
	let r = Object.getPrototypeOf(e._zod);
	t in r && at !== e._zod ? at = void 0 : (at = e._zod, Object.defineProperty(r, t, {
		configurable: !0,
		get() {
			Object.defineProperty(this, t, st);
			let e = ot;
			ot = !1;
			try {
				let r = n(this);
				return ot ? delete this[t] : Object.defineProperty(this, t, {
					configurable: !0,
					writable: !0,
					value: r
				}), ot ||= e, r;
			} catch (n) {
				throw delete this[t], ot ||= e, n;
			}
		},
		set(e) {
			Object.defineProperty(this, t, {
				configurable: !0,
				writable: !0,
				value: e
			});
		}
	}));
}
function ct(e, t, n, r) {
	let i = it(e, t);
	i && Object.defineProperty(i, t, {
		configurable: !0,
		get() {
			let e = {
				configurable: !0,
				writable: !0,
				enumerable: r,
				value: void 0
			};
			return Object.defineProperty(this, t, e), e.value = n(this), Object.defineProperty(this, t, e), e.value;
		},
		set(e) {
			Object.defineProperty(this, t, {
				configurable: !0,
				writable: !0,
				enumerable: r,
				value: e
			});
		}
	});
}
var lt = "~constantCatch";
function ut(e) {
	let t = () => e;
	return t[lt] = !0, t;
}
// node_modules/zod/v4/core/core.js
var dt, ft = {
	value: void 0,
	enumerable: !1
}, pt = "captureStackTrace" in Error ? Error : null;
function mt(e) {
	let t = pt;
	if (t) {
		let n = t.stackTraceLimit;
		if (typeof n == "number") {
			try {
				t.stackTraceLimit = 0;
			} catch {
				return pt = null, new e();
			}
			try {
				return new e();
			} finally {
				t.stackTraceLimit = n;
			}
		}
	}
	return new e();
}
/* @__NO_SIDE_EFFECTS__ */
function T(e, t, n, r) {
	let i = {};
	function a(e) {
		this.def = e, this.constr = d, this.traits = /* @__PURE__ */ new Set();
	}
	a.prototype = i;
	let o = n, s = o && /* @__PURE__ */ new WeakSet();
	function c(n, r) {
		if (!n._zod) {
			ft.value = new a(r);
			try {
				Object.defineProperty(n, "_zod", ft);
			} finally {
				ft.value = void 0;
			}
		} else if (n._zod.traits.has(e)) return;
		if (n._zod.traits.add(e), t(n, r), s) {
			let e = Object.getPrototypeOf(n), t = n._zod.constr.prototype, r = e;
			for (; r && r !== t;) r = Object.getPrototypeOf(r);
			let i = r ?? e;
			s.has(i) || (s.add(i), $e(i, o));
		}
		let i = d.prototype;
		for (let e in i) Object.prototype.hasOwnProperty.call(i, e) && (e in n || (n[e] = i[e].bind(n)));
	}
	let l = r?.Parent ?? Object;
	class u extends l {}
	Object.defineProperty(u, "name", { value: e });
	function d(e) {
		let t = r?.Parent ? mt(u) : this;
		c(t, e);
		let n = t._zod.deferred;
		if (n) {
			for (let e of n) e();
			t._zod.deferred = void 0;
		}
		let i = globalThis.__zod_globalConfig?.postProcessor;
		return i && i(t), t;
	}
	return Object.defineProperty(d, "init", { value: c }), Object.defineProperty(d, Symbol.hasInstance, { value: (t) => r?.Parent && t instanceof r.Parent ? !0 : t?._zod?.traits?.has(e) }), Object.defineProperty(d, "name", { value: e }), d;
}
var ht = class extends Error {
	constructor() {
		super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
	}
}, gt = class extends Error {
	constructor(e) {
		super(`Encountered unidirectional transform during encode: ${e}`), this.name = "ZodEncodeError";
	}
};
(dt = globalThis).__zod_globalConfig ?? (dt.__zod_globalConfig = {});
var _t = globalThis.__zod_globalConfig;
function vt(e) {
	return e && Object.assign(_t, e), _t;
}
// node_modules/zod/v4/core/errors.js
function yt() {
	let e = this._zod;
	return e.message ??= JSON.stringify(e.def, ae, 2), e.message;
}
function bt(e) {
	this._zod.message = e;
}
var xt = {
	get: yt,
	set: bt,
	enumerable: !0,
	configurable: !0
}, St = {
	value: void 0,
	enumerable: !1
}, Ct = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]), wt = /* @__PURE__ */ T("$ZodError", (e, t) => {
	e.name = "$ZodError", St.value = t, Object.defineProperty(e, "issues", St), St.value = void 0, Object.defineProperty(e, "message", xt);
	let n = Object.getPrototypeOf(e);
	Ct.has(n) || (Ct.add(n), Object.defineProperty(n, "toString", {
		configurable: !0,
		enumerable: !1,
		get() {
			let e = () => this.message;
			return Object.defineProperty(this, "toString", {
				value: e,
				configurable: !0,
				writable: !0
			}), e;
		},
		set(e) {
			Object.defineProperty(this, "toString", {
				value: e,
				configurable: !0,
				writable: !0
			});
		}
	}));
});
function Tt(e, t, n) {
	return Object.prototype.hasOwnProperty.call(e, t) || (t === "__proto__" ? Object.defineProperty(e, t, {
		value: n(),
		writable: !0,
		enumerable: !0,
		configurable: !0
	}) : e[t] = n()), e[t];
}
function Et(e, t = (e) => e.message) {
	let n = {}, r = [];
	for (let i of e.issues) i.path.length > 0 ? Tt(n, i.path[0], () => []).push(t(i)) : r.push(t(i));
	return {
		formErrors: r,
		fieldErrors: n
	};
}
function Dt(e, t = (e) => e.message) {
	let n = { _errors: [] }, r = (e, i = []) => {
		for (let a of e.issues) if (a.code === "invalid_union" && a.errors.length) a.errors.map((e) => r({ issues: e }, [...i, ...a.path]));
		else if (a.code === "invalid_key") r({ issues: a.issues }, [...i, ...a.path]);
		else if (a.code === "invalid_element") r({ issues: a.issues }, [...i, ...a.path]);
		else {
			let e = [...i, ...a.path];
			if (e.length === 0) n._errors.push(t(a));
			else {
				let r = n, i = 0;
				for (; i < e.length;) {
					let n = e[i], o = i === e.length - 1;
					if (n === "_errors") {
						o && r._errors.push(t(a)), i++;
						continue;
					}
					Object.prototype.hasOwnProperty.call(r, n) || Object.defineProperty(r, n, {
						value: { _errors: [] },
						enumerable: !0,
						writable: !0,
						configurable: !0
					});
					let s = r[n];
					o && s._errors.push(t(a)), r = s, i++;
				}
			}
		}
	};
	return r(e), n;
}
// node_modules/zod/v4/core/parse.js
function Ot(e, t) {
	return {
		callee: t?.callee ?? e,
		Err: t?.Err
	};
}
var kt = (e) => {
	let t = (n, r, i, a) => {
		let o = i ? {
			...i,
			async: !1
		} : { async: !1 }, s = n._zod.run({
			value: r,
			issues: []
		}, o);
		if (s instanceof Promise) throw new ht();
		if (s.issues.length) {
			let n = new ((a?.Err) ?? e)(s.issues.map((e) => qe(e, o, vt())));
			throw be(n, a?.callee ?? t), n;
		}
		return s.value;
	};
	return t;
}, At = (e) => {
	let t = async (n, r, i, a) => {
		let o = i ? {
			...i,
			async: !0
		} : { async: !0 }, s = n._zod.run({
			value: r,
			issues: []
		}, o);
		if (s instanceof Promise && (s = await s), s.issues.length) {
			let n = new ((a?.Err) ?? e)(s.issues.map((e) => qe(e, o, vt())));
			throw be(n, a?.callee ?? t), n;
		}
		return s.value;
	};
	return t;
}, jt = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		async: !1
	} : { async: !1 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	if (a instanceof Promise) throw new ht();
	return a.issues.length ? Mt(e, a.issues, i) : {
		success: !0,
		data: a.value
	};
};
function Mt(e, t, n) {
	let r;
	return {
		success: !1,
		get error() {
			return r || (r = new e(t.map((e) => qe(e, n, vt()))), t = void 0, n = void 0), r;
		},
		set error(e) {
			r = e, t = void 0, n = void 0;
		}
	};
}
var Nt = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		async: !0
	} : { async: !0 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	return a instanceof Promise && (a = await a), a.issues.length ? Mt(e, a.issues, i) : {
		success: !0,
		data: a.value
	};
}, Pt = /* @__PURE__ */ Symbol.for("zod.compile.invalid"), Ft = /* @__PURE__ */ Symbol.for("zod.compile.fallback"), It = ((e, t, n) => {
	let r = e._zod.bag.validator;
	if (r !== void 0) {
		if (r(t) !== Pt) return !0;
		if (r.definite === !0 && n === void 0) return !1;
	}
	return Lt(e, t, n);
});
function Lt(e, t, n) {
	let r = n ? {
		...n,
		async: !1,
		abortEarly: !0
	} : {
		async: !1,
		abortEarly: !0
	}, i = e._zod.bag.fallbackRun, a;
	if (i ? (r[Ft] = !0, a = i({
		value: t,
		issues: []
	}, r)) : a = e._zod.run({
		value: t,
		issues: []
	}, r), a instanceof Promise) throw new ht();
	return a.issues.length === 0;
}
var Rt = async (e, t, n) => {
	let r = n ? {
		...n,
		async: !0,
		abortEarly: !0
	} : {
		async: !0,
		abortEarly: !0
	}, i = e._zod.run({
		value: t,
		issues: []
	}, r);
	return i instanceof Promise && (i = await i), i.issues.length === 0;
}, zt = (e) => {
	let t = kt(e), n = (e, r, i, a) => {
		let o = i ? {
			...i,
			direction: "backward"
		} : { direction: "backward" };
		return t(e, r, o, Ot(n, a));
	};
	return n;
}, Bt = (e) => {
	let t = kt(e), n = (e, r, i, a) => t(e, r, i, Ot(n, a));
	return n;
}, Vt = (e) => {
	let t = At(e), n = async (e, r, i, a) => {
		let o = i ? {
			...i,
			direction: "backward"
		} : { direction: "backward" };
		return await t(e, r, o, Ot(n, a));
	};
	return n;
}, Ht = (e) => {
	let t = At(e), n = async (e, r, i, a) => await t(e, r, i, Ot(n, a));
	return n;
}, Ut = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return jt(e)(t, n, i);
}, Wt = (e) => (t, n, r) => jt(e)(t, n, r), Gt = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return Nt(e)(t, n, i);
}, Kt = (e) => async (t, n, r) => Nt(e)(t, n, r), qt = /^[cC][0-9a-z]{6,}$/, Jt = /^[0-9a-z]+$/, Yt = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/, Xt = /^[0-9a-vA-V]{20}$/, Zt = /^[A-Za-z0-9]{27}$/, Qt = /^[a-zA-Z0-9_-]{21}$/;
function $t(e) {
	return RegExp(`^[a-zA-Z0-9_-]{${e}}$`);
}
var en = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, tn = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, nn = (e) => e ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, rn = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, an = "^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$";
function on() {
	return new RegExp(an, "u");
}
var sn = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, cn = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, ln = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, un = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, dn = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, fn = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/, pn = /^https?$/, mn = /^\+[1-9]\d{6,14}$/, hn = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
function gn(e) {
	return RegExp(`^${e}$`);
}
var _n = /*@__PURE__*/ gn(hn);
function vn(e) {
	let t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
	return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : e.seconds ? `${t}:[0-5]\\d(?:\\.\\d+)?` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function yn(e) {
	return RegExp(`^${vn(e)}$`);
}
function bn(e) {
	let t = ["Z"];
	e.offset && t.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
	let n = `${vn({
		precision: e.precision,
		seconds: !0
	})}(?:${t.join("|")})`, r = e.local ? `${n}|${vn({ precision: e.precision })}` : n;
	return RegExp(`^${hn}T(?:${r})$`);
}
var xn = /^[\s\S]{0,}$/, Sn = /^-?\d+$/, Cn = /^-?\d+(?:\.\d+)?$/, wn = /^(?:true|false)$/i, Tn = /^[^A-Z]*$/, En = /^[^a-z]*$/, E = /*@__PURE__*/ T("$ZodCheck", (e, t) => {
	var n;
	e._zod ??= {}, e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), Dn = (e) => {
	let t = e.value;
	return !ce(t) && t.length !== void 0;
}, On = {
	number: "number",
	bigint: "bigint",
	object: "date"
}, kn = /*@__PURE__*/ T("$ZodCheckLessThan", (e, t) => {
	E.init(e, t);
	let n = On[typeof t.value];
	e._zod.check = (r) => {
		(t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
			origin: On[typeof r.value] ?? n,
			code: "too_big",
			maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), An = /*@__PURE__*/ T("$ZodCheckGreaterThan", (e, t) => {
	E.init(e, t);
	let n = On[typeof t.value];
	e._zod.check = (r) => {
		(t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
			origin: On[typeof r.value] ?? n,
			code: "too_small",
			minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), jn = /*@__PURE__*/ T("$ZodCheckMultipleOf", (e, t) => {
	E.init(e, t), e._zod.check = (n) => {
		if (typeof n.value != typeof t.value) throw Error("Cannot mix number and bigint in multiple_of check.");
		(typeof n.value == "bigint" ? t.value !== BigInt(0) && n.value % t.value === BigInt(0) : ue(n.value, t.value) === 0) || n.issues.push({
			origin: typeof n.value,
			code: "not_multiple_of",
			divisor: t.value,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Mn = /*@__PURE__*/ T("$ZodCheckNumberFormat", (e, t) => {
	E.init(e, t), t.format = t.format || "float64";
	let n = t.format?.includes("int"), r = n ? "int" : "number", [i, a] = Ae[t.format];
	e._zod.check = (o) => {
		let s = o.value;
		if (n) {
			if (!Number.isInteger(s)) {
				o.issues.push({
					expected: r,
					format: t.format,
					code: "invalid_type",
					continue: !1,
					input: s,
					inst: e
				});
				return;
			}
			if (!Number.isSafeInteger(s)) {
				s > 0 ? o.issues.push({
					input: s,
					code: "too_big",
					maximum: 2 ** 53 - 1,
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					inclusive: !0,
					continue: !t.abort
				}) : o.issues.push({
					input: s,
					code: "too_small",
					minimum: -(2 ** 53 - 1),
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					inclusive: !0,
					continue: !t.abort
				});
				return;
			}
		}
		s < i && o.issues.push({
			origin: "number",
			input: s,
			code: "too_small",
			minimum: i,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		}), s > a && o.issues.push({
			origin: "number",
			input: s,
			code: "too_big",
			maximum: a,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		});
	};
}), Nn = /*@__PURE__*/ T("$ZodCheckMaxLength", (e, t) => {
	var n;
	E.init(e, t), (n = e._zod.def).when ?? (n.when = Dn), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if ((typeof r == "string" && i > t.maximum ? Ye(r) : i) <= t.maximum) return;
		let a = Xe(r);
		n.issues.push({
			origin: a,
			code: "too_big",
			maximum: t.maximum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), Pn = /*@__PURE__*/ T("$ZodCheckMinLength", (e, t) => {
	var n;
	E.init(e, t), (n = e._zod.def).when ?? (n.when = Dn), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if ((typeof r == "string" && i >= t.minimum && i < t.minimum * 2 ? Ye(r) : i) >= t.minimum) return;
		let a = Xe(r);
		n.issues.push({
			origin: a,
			code: "too_small",
			minimum: t.minimum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), Fn = /*@__PURE__*/ T("$ZodCheckLengthEquals", (e, t) => {
	var n;
	E.init(e, t), (n = e._zod.def).when ?? (n.when = Dn), e._zod.check = (n) => {
		let r = n.value, i = r.length, a = typeof r == "string" && i >= t.length && i <= t.length * 2 ? Ye(r) : i;
		if (a === t.length) return;
		let o = Xe(r), s = a > t.length;
		n.issues.push({
			origin: o,
			...s ? {
				code: "too_big",
				maximum: t.length
			} : {
				code: "too_small",
				minimum: t.length
			},
			inclusive: !0,
			exact: !0,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), In = /*@__PURE__*/ T("$ZodCheckStringFormat", (e, t) => {
	var n, r;
	E.init(e, t), t.pattern ? (n = e._zod).check ?? (n.check = (n) => {
		t.pattern.lastIndex = 0, t.pattern.test(n.value) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: t.format,
			input: n.value,
			...t.pattern ? { pattern: t.pattern.toString() } : {},
			inst: e,
			continue: !t.abort
		});
	}) : (r = e._zod).check ?? (r.check = () => {});
}), Ln = /*@__PURE__*/ T("$ZodCheckRegex", (e, t) => {
	In.init(e, t), e._zod.check = (n) => {
		t.pattern.lastIndex = 0, t.pattern.test(n.value) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: n.value,
			pattern: t.pattern.toString(),
			inst: e,
			continue: !t.abort
		});
	};
}), Rn = /*@__PURE__*/ T("$ZodCheckLowerCase", (e, t) => {
	t.pattern ??= Tn, In.init(e, t);
}), zn = /*@__PURE__*/ T("$ZodCheckUpperCase", (e, t) => {
	t.pattern ??= En, In.init(e, t);
}), Bn = /*@__PURE__*/ T("$ZodCheckIncludes", (e, t) => {
	E.init(e, t);
	let n = Ee(t.includes);
	t.pattern = new RegExp(typeof t.position == "number" ? `^.{${t.position},}${n}` : n), e._zod.check = (n) => {
		n.value.includes(t.includes, t.position) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: t.includes,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Vn = /*@__PURE__*/ T("$ZodCheckStartsWith", (e, t) => {
	E.init(e, t);
	let n = RegExp(`^${Ee(t.prefix)}.*`);
	t.pattern ??= n, e._zod.check = (n) => {
		n.value.startsWith(t.prefix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: t.prefix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Hn = /*@__PURE__*/ T("$ZodCheckEndsWith", (e, t) => {
	E.init(e, t);
	let n = RegExp(`.*${Ee(t.suffix)}$`);
	t.pattern ??= n, e._zod.check = (n) => {
		n.value.endsWith(t.suffix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: t.suffix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Un = /*@__PURE__*/ T("$ZodCheckOverwrite", (e, t) => {
	E.init(e, t), e._zod.check = (e) => {
		e.value = t.tx(e.value);
	};
}), Wn = class {
	constructor(e = [], t = {}) {
		this.content = [], this.indent = 0, this.args = e, this.closed = t;
	}
	indented(e) {
		this.indent += 1;
		try {
			e(this);
		} finally {
			--this.indent;
		}
	}
	write(e) {
		if (typeof e == "function") {
			e(this, { execution: "sync" }), e(this, { execution: "async" });
			return;
		}
		let t = e.split("\n").filter((e) => e), n = Math.min(...t.map((e) => e.length - e.trimStart().length)), r = t.map((e) => e.slice(n)).map((e) => " ".repeat(this.indent * 2) + e);
		for (let e of r) this.content.push(e);
	}
	compile() {
		let e = Function, t = this?.content ?? [""];
		return new e(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {\n${t.join("\n")}\n};`)(...Object.values(this.closed));
	}
}, Gn = {
	major: 4,
	minor: 6,
	patch: 7
}, D = /*@__PURE__*/ T("$ZodType", (e, t) => {
	var n;
	e ??= {}, e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = Gn;
	let r = e._zod.def.checks, i = e._zod.traits.has("$ZodCheck") ? [e, ...r ?? []] : r?.length ? [...r] : [];
	for (let t of i) for (let n of t._zod.onattach) n(e);
	if (i.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
		e._zod.run = e._zod.parse;
	});
	else {
		let t = (t, n, r) => {
			if (t.memo) return t;
			let i = Ve(t), a;
			for (let o of n) {
				if (o._zod.def.when) {
					if (He(t) || !o._zod.def.when(t)) continue;
				} else if (i) continue;
				let n = t.issues.length, s = o._zod.check(t);
				if (s instanceof Promise && r?.async === !1) throw new ht();
				if (a || s instanceof Promise) a = (a ?? Promise.resolve()).then(async () => {
					await s, t.issues.length !== n && (Ke(t.issues, n, e), i ||= Ve(t, n));
				});
				else {
					if (t.issues.length === n) continue;
					Ke(t.issues, n, e), i ||= Ve(t, n);
				}
			}
			return a ? a.then(() => t) : t;
		}, n = (n, r, a) => {
			if (Ve(n)) return n.aborted = !0, n;
			let o = t(r, i, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new ht();
				return o.then((t) => e._zod.parse(t, a));
			}
			return e._zod.parse(o, a);
		};
		e._zod.run = (r, a) => {
			if (a.skipChecks) return e._zod.parse(r, a);
			if (a.direction === "backward") {
				let t = e._zod.parse({
					value: r.value,
					issues: []
				}, {
					...a,
					skipChecks: !0
				});
				return t instanceof Promise ? t.then((e) => n(e, r, a)) : n(t, r, a);
			}
			let o = e._zod.parse(r, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new ht();
				return o.then((e) => t(e, i, a));
			}
			return t(o, i, a);
		};
	}
}, {
	get "~standard"() {
		return tt(this, "~standard", Jn(this));
	},
	set "~standard"(e) {
		et(this, "~standard", e);
	}
}), Kn = (e, t) => e.issues.length ? { issues: e.issues.map((e) => qe(e, t, vt())) } : { value: e.value };
async function qn(e, t) {
	let n = { async: !0 };
	return Kn(await e._zod.run({
		value: t,
		issues: []
	}, n), n);
}
function Jn(e) {
	return {
		validate: (t) => {
			let n = { async: !1 };
			try {
				let r = e._zod.run({
					value: t,
					issues: []
				}, n);
				if (!(r instanceof Promise)) return Kn(r, n);
			} catch {}
			return qn(e, t);
		},
		vendor: "zod",
		version: 1
	};
}
var Yn = /*@__PURE__*/ T("$ZodString", (e, t) => {
	D.init(e, t), e._zod.pattern = t.pattern ?? xn, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = String(n.value);
		} catch {}
		return typeof n.value == "string" || n.issues.push({
			expected: "string",
			code: "invalid_type",
			input: n.value,
			inst: e
		}), n;
	};
}), O = /*@__PURE__*/ T("$ZodStringFormat", (e, t) => {
	In.init(e, t), Yn.init(e, t);
}), Xn = /*@__PURE__*/ T("$ZodGUID", (e, t) => {
	t.pattern ??= tn, O.init(e, t);
}), Zn = /*@__PURE__*/ T("$ZodUUID", (e, t) => {
	if (t.version) {
		let e = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[t.version];
		if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`);
		t.pattern ??= nn(e);
	} else t.pattern ??= nn();
	O.init(e, t);
}), Qn = /*@__PURE__*/ T("$ZodEmail", (e, t) => {
	t.pattern ??= rn, O.init(e, t);
});
function $n(e) {
	try {
		return typeof URL < "u" && typeof URL.canParse == "function" ? URL.canParse(e) : (new URL(e), !0);
	} catch {
		return !1;
	}
}
function er(e, t) {
	return !("normalize" in t) && !("hostname" in t) && !("protocol" in t) ? $n(e) || 2 : tr(e, t);
}
function tr(e, t) {
	if (!t.normalize && t.protocol?.source === pn.source && !/^https?:\/\//i.test(e)) return 1;
	try {
		if (typeof URL < "u") {
			let t = URL;
			if (typeof t.parse == "function") return t.parse(e) ?? 2;
		}
		return new URL(e);
	} catch {
		return 2;
	}
}
var nr = /[\t\n\r]/g;
function rr(e) {
	return e.replace(nr, "");
}
function ir(e, t) {
	return t.lastIndex = 0, t.test(e.hostname);
}
function ar(e, t) {
	return t.lastIndex = 0, t.test(e.protocol.endsWith(":") ? e.protocol.slice(0, -1) : e.protocol);
}
var or = /*@__PURE__*/ T("$ZodURL", (e, t) => {
	O.init(e, t), e._zod.check = (n) => {
		try {
			let r = n.value.trim(), i = er(r, t);
			if (i === 1) {
				n.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid URL format",
					input: n.value,
					inst: e,
					continue: !t.abort
				});
				return;
			}
			if (i === 2) {
				n.issues.push({
					code: "invalid_format",
					format: "url",
					input: n.value,
					inst: e,
					continue: !t.abort
				});
				return;
			}
			if (i === !0) {
				n.value = rr(r);
				return;
			}
			t.hostname && !ir(i, t.hostname) && n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: t.hostname.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			}), t.protocol && !ar(i, t.protocol) && n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: t.protocol.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			}), n.value = t.normalize ? i.href : rr(r);
			return;
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "url",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
}), sr = /*@__PURE__*/ T("$ZodEmoji", (e, t) => {
	t.pattern ??= on(), O.init(e, t);
}), cr = /*@__PURE__*/ T("$ZodNanoID", (e, t) => {
	if (t.length !== void 0 && (!Number.isInteger(t.length) || t.length < 1)) throw Error(`Invalid nanoid length: ${t.length}`);
	t.pattern ??= t.length === void 0 ? Qt : $t(t.length), O.init(e, t);
}), lr = /*@__PURE__*/ T("$ZodCUID", (e, t) => {
	t.pattern ??= qt, O.init(e, t);
}), ur = /*@__PURE__*/ T("$ZodCUID2", (e, t) => {
	t.pattern ??= Jt, O.init(e, t);
}), dr = /*@__PURE__*/ T("$ZodULID", (e, t) => {
	t.pattern ??= Yt, O.init(e, t);
}), fr = /*@__PURE__*/ T("$ZodXID", (e, t) => {
	t.pattern ??= Xt, O.init(e, t);
}), pr = /*@__PURE__*/ T("$ZodKSUID", (e, t) => {
	t.pattern ??= Zt, O.init(e, t);
}), mr = /*@__PURE__*/ T("$ZodISODateTime", (e, t) => {
	t.pattern ??= bn(t), O.init(e, t);
}), hr = /*@__PURE__*/ T("$ZodISODate", (e, t) => {
	t.pattern ??= _n, O.init(e, t);
}), gr = /*@__PURE__*/ T("$ZodISOTime", (e, t) => {
	t.pattern ??= yn(t), O.init(e, t);
}), _r = /*@__PURE__*/ T("$ZodISODuration", (e, t) => {
	t.pattern ??= en, O.init(e, t);
}), vr = /*@__PURE__*/ T("$ZodIPv4", (e, t) => {
	t.pattern ??= sn, O.init(e, t);
}), yr = /^[0-9a-fA-F:.]+$/;
function br(e) {
	return yr.test(e) ? $n(`http://[${e}]`) : !1;
}
var xr = /*@__PURE__*/ T("$ZodIPv6", (e, t) => {
	t.pattern ??= cn, O.init(e, t), e._zod.check = (n) => {
		br(n.value) || n.issues.push({
			code: "invalid_format",
			format: "ipv6",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Sr = /*@__PURE__*/ T("$ZodCIDRv4", (e, t) => {
	t.pattern ??= ln, O.init(e, t);
});
function Cr(e) {
	let t = e.split("/");
	if (t.length !== 2) return !1;
	let [n, r] = t;
	if (!r) return !1;
	let i = Number(r);
	return `${i}` !== r || i < 0 || i > 128 ? !1 : br(n);
}
var wr = /*@__PURE__*/ T("$ZodCIDRv6", (e, t) => {
	t.pattern ??= un, O.init(e, t), e._zod.check = (n) => {
		Cr(n.value) || n.issues.push({
			code: "invalid_format",
			format: "cidrv6",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
});
function Tr(e) {
	if (e === "") return !0;
	if (/\s/.test(e) || e.length % 4 != 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var Er = /^[0-9a-zA-Z+/]*={0,2}$/, Dr = /*@__PURE__*/ T("$ZodBase64", (e, t) => {
	t.pattern ??= Er, O.init(e, t), e._zod.check = (n) => {
		Tr(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Or = /^[A-Za-z0-9_-]*$/;
function kr(e) {
	if (!Or.test(e)) return !1;
	let t = e.replace(/[-_]/g, (e) => e === "-" ? "+" : "/");
	return Tr(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
var Ar = /*@__PURE__*/ T("$ZodBase64URL", (e, t) => {
	t.pattern ??= Or, O.init(e, t), e._zod.check = (n) => {
		kr(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), jr = /*@__PURE__*/ T("$ZodE164", (e, t) => {
	t.pattern ??= mn, O.init(e, t);
});
function Mr(e, t = null) {
	try {
		let n = e.split(".");
		if (n.length !== 3) return !1;
		let [r] = n;
		if (!r) return !1;
		let i = JSON.parse(atob(r));
		return !("typ" in i && i?.typ !== "JWT" || !i.alg || t && (!("alg" in i) || i.alg !== t));
	} catch {
		return !1;
	}
}
var Nr = /*@__PURE__*/ T("$ZodJWT", (e, t) => {
	O.init(e, t), e._zod.check = (n) => {
		Mr(n.value, t.alg) || n.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Pr = /*@__PURE__*/ T("$ZodNumber", (e, t) => {
	D.init(e, t), e._zod.pattern = Cn, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = Number(n.value);
		} catch {}
		let i = n.value;
		if (typeof i == "number" && !Number.isNaN(i) && Number.isFinite(i)) return n;
		let a = typeof i == "number" ? Number.isNaN(i) ? "NaN" : Number.isFinite(i) ? void 0 : String(i) : void 0;
		return n.issues.push({
			expected: "number",
			code: "invalid_type",
			input: i,
			inst: e,
			...a ? { received: a } : {}
		}), n;
	};
}), Fr = /*@__PURE__*/ T("$ZodNumberFormat", (e, t) => {
	Mn.init(e, t), Pr.init(e, t);
}), Ir = /*@__PURE__*/ T("$ZodBoolean", (e, t) => {
	D.init(e, t), e._zod.pattern = wn, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = !!n.value;
		} catch {}
		let i = n.value;
		return typeof i == "boolean" || n.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
	};
}), Lr = /*@__PURE__*/ T("$ZodUnknown", (e, t) => {
	D.init(e, t), e._zod.parse = (e) => e;
}), Rr = /*@__PURE__*/ T("$ZodNever", (e, t) => {
	D.init(e, t), e._zod.parse = (t, n) => (t.issues.push({
		expected: "never",
		code: "invalid_type",
		input: t.value,
		inst: e
	}), t);
});
function zr(e, t) {
	let n = Ge(e._zod.def.checks);
	if (!n.length) return;
	let r = Math.min(...n.map((e) => e[0])), i = e._zod.parse;
	e._zod.parse = (n, a) => {
		let o = t(n.value);
		if (o > r && !a?.skipChecks && a?.direction !== "backward") {
			for (let [t, r] of Ge(e._zod.def.checks)) if (o > t && r._zod.def.when(n)) {
				let t = n.issues.length;
				return r._zod.check(n), n.issues[t].continue = !1, Ke(n.issues, t, e), n;
			}
		}
		return i(n, a);
	};
}
var Br = (e) => Array.isArray(e) ? e.length : -1;
function Vr(e, t, n) {
	e.issues.length && t.issues.push(...Ue(n, e.issues)), t.value[n] = e.value;
}
var Hr = /*@__PURE__*/ T("$ZodArray", (e, t) => {
	D.init(e, t);
	let n = _t.memoizer;
	n?.attach(e), e._zod.parse = (r, i) => {
		let a = r.value;
		if (!Array.isArray(a)) return r.issues.push({
			expected: "array",
			code: "invalid_type",
			input: a,
			inst: e
		}), r;
		r.value = n ? n.alloc(e, r, Array(a.length), i) : Array(a.length);
		let o = [], s = i?.abortEarly;
		for (let e = 0; e < a.length; e++) {
			let n = a[e], c = t.element._zod.run({
				value: n,
				issues: []
			}, i);
			if (c instanceof Promise) o.push(c.then((t) => Vr(t, r, e)));
			else if (Vr(c, r, e), s && c.issues.length !== 0 && Ve(c)) break;
		}
		return o.length ? Promise.all(o).then(() => r) : r;
	}, zr(e, Br);
});
function Ur(e, t, n, r, i, a) {
	let o = n in r, s = a === "optional";
	if (o || !s || i !== "optional") {
		if (e.issues.length) {
			if (i !== void 0 && s && !o) return;
			t.issues.push(...Ue(n, e.issues));
		}
		!o && i === void 0 ? e.issues.length || t.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [n]
		}) : e.value === void 0 ? (o || i === "defaulted" && !s) && (t.value[n] = void 0) : t.value[n] = e.value;
	}
}
var Wr = [];
function Gr(e) {
	let t = Object.keys(e.shape), n = Object.getOwnPropertySymbols(e.shape), r = n.length ? n : Wr, i = r.length ? [...t, ...r] : t;
	for (let t of i) if (!e.shape?.[t]?._zod?.traits?.has("$ZodType")) throw Error(`Invalid element at key "${String(t)}": expected a Zod schema`);
	let a = ke(e.shape);
	return {
		...e,
		allKeys: i,
		symbolKeys: r,
		keySet: new Set(t),
		numKeys: t.length,
		optionalKeys: new Set(a)
	};
}
function Kr(e, t, n, r, i, a, o) {
	let s = [], c = i.keySet, l = i.catchall._zod, u = l.def.type, d = l.optin, f = l.optout, p = 0;
	for (let i in t) {
		if (o && n.issues.length !== p) {
			if (Ve(n, p)) break;
			p = n.issues.length;
		}
		if (c.has(i)) continue;
		if (i === "__proto__") {
			u === "never" && s.push(i);
			continue;
		}
		if (u === "never") {
			s.push(i);
			continue;
		}
		let a = l.run({
			value: t[i],
			issues: []
		}, r);
		a instanceof Promise ? e.push(a.then((e) => Ur(e, n, i, t, d, f))) : Ur(a, n, i, t, d, f);
	}
	return s.length && n.issues.push({
		code: "unrecognized_keys",
		keys: s,
		input: t,
		inst: a,
		continue: !0
	}), e.length ? Promise.all(e).then(() => n) : n;
}
var qr = /*@__PURE__*/ T("$ZodObject", (e, t) => {
	D.init(e, t);
	let n = Object.getOwnPropertyDescriptor(t, "shape"), r = n?.get ? n.get.raw : t.shape ?? {};
	if (r) {
		let e = () => {
			let n = { ...r };
			return Object.defineProperty(t, "shape", { value: n }), e.raw = n, n;
		};
		e.raw = r, Object.defineProperty(t, "shape", { get: e });
	}
	let i = se(() => Gr(t));
	w(e, "propValues", (e) => {
		let t = e.def.shape, n = {};
		for (let e in t) {
			let r = t[e]._zod;
			if (r.values) {
				Object.prototype.hasOwnProperty.call(n, e) || de(n, e, /* @__PURE__ */ new Set());
				for (let t of r.values) n[e].add(t);
				r.optin !== void 0 && n[e].add(void 0);
			}
		}
		return n;
	});
	let a = xe, o = t.catchall, s, c = _t.memoizer;
	c?.attach(e), e._zod.parse = (t, n) => {
		s ??= i.value;
		let r = t.value;
		if (!a(r)) return t.issues.push({
			expected: "object",
			code: "invalid_type",
			input: r,
			inst: e
		}), t;
		t.value = c ? c.alloc(e, t, {}, n) : {};
		let l = [], u = s.shape, d = n?.abortEarly, f = t.issues.length;
		for (let e of s.allKeys) {
			if (d && t.issues.length !== f) {
				if (Ve(t, f)) break;
				f = t.issues.length;
			}
			if (e === "__proto__") continue;
			let i = u[e], a = i._zod.optin, o = i._zod.optout, s = i._zod.run({
				value: r[e],
				issues: []
			}, n);
			s instanceof Promise ? l.push(s.then((n) => Ur(n, t, e, r, a, o))) : Ur(s, t, e, r, a, o);
		}
		return o ? Kr(l, r, t, n, i.value, e, d === !0) : l.length ? Promise.all(l).then(() => t) : t;
	};
}), Jr = /*@__PURE__*/ T("$ZodObjectJIT", (e, t) => {
	qr.init(e, t);
	let n = e._zod.parse, r = se(() => Gr(t)), i = _t.memoizer, a = (t) => {
		let n = r.value, a = n.symbolKeys, o = new Wn(["payload", "ctx"], {
			shape: t,
			inst: e,
			memo: i,
			syms: a
		}), s = (e) => `shape[${e}]._zod.run({ value: input[${e}], issues: [] }, ctx)`, c = (e, t) => `
          let ${e}_ab = false;
          for (let i = 0; i < ${e}.issues.length; i++) {
            const iss = ${e}.issues[i];
            iss.path = iss.path ? [${t}, ...iss.path] : [${t}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${e}_ab = true;
          }
          if (${e}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
		o.write("const input = payload.value;");
		let l = Object.create(null), u = 0;
		for (let e of n.allKeys) l[e] = `key_${u++}`;
		o.write(i ? "const newResult = memo.alloc(inst, payload, {}, ctx);" : "const newResult = {};");
		for (let e of n.allKeys) {
			if (e === "__proto__") continue;
			let n = l[e], r = typeof e == "symbol" ? `syms[${a.indexOf(e)}]` : ve(e), i = `${r} in input`, u = t[e], d = u?._zod?.optin, f = d !== void 0, p = u?._zod?.optout === "optional";
			if (o.write(`const ${n} = ${s(r)};`), f && p) {
				let e = d === "optional" ? `${n}_present` : `${n}.value !== undefined || ${n}_present`;
				o.write(`
        const ${n}_present = ${i};
        if (!${n}.issues.length || ${n}_present) {
          if (${n}.issues.length) {${c(n, r)}
          }

          if (${e}) {
            newResult[${r}] = ${n}.value;
          }
        }

      `);
			} else f ? (o.write(`
        if (${n}.issues.length) {${c(n, r)}
        }
      `), d === "defaulted" ? o.write(`newResult[${r}] = ${n}.value;`) : o.write(`
        if (${n}.value !== undefined || ${i}) {
          newResult[${r}] = ${n}.value;
        }
      `)) : o.write(`
        const ${n}_present = ${i};
        if (${n}.issues.length) {${c(n, r)}
        }
        if (!${n}_present && !${n}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${r}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${n}_present) {
          newResult[${r}] = ${n}.value;
        }

      `);
		}
		return o.write("payload.value = newResult;"), o.write("return payload;"), o.compile();
	}, o, s = xe, c = !_t.jitless, l = c && Se.value, u = t.catchall, d;
	e._zod.parse = (i, f) => {
		d ??= r.value;
		let p = i.value;
		return s(p) ? c && l && f?.async === !1 && f.jitless !== !0 ? (o ||= a(t.shape), i = o(i, f), u ? Kr([], p, i, f, d, e, f?.abortEarly === !0) : i) : n(i, f) : (i.issues.push({
			expected: "object",
			code: "invalid_type",
			input: p,
			inst: e
		}), i);
	};
});
function Yr(e, t, n, r) {
	for (let n of e) if (n.issues.length === 0) return t.value = n.value, t;
	let i = e.filter((e) => !Ve(e));
	return i.length === 1 ? (t.value = i[0].value, i[0]) : (t.issues.push({
		code: "invalid_union",
		input: t.value,
		inst: n,
		errors: e.map((e) => e.issues.map((e) => qe(e, r, vt())))
	}), t);
}
var Xr = /*@__PURE__*/ T("$ZodUnion", (e, t) => {
	D.init(e, t), w(e, "optin", (e) => e.def.options.some((e) => e._zod.optin === "defaulted") ? "defaulted" : e.def.options.some((e) => e._zod.optin !== void 0) ? "optional" : void 0), w(e, "optout", (e) => e.def.options.some((e) => e._zod.optout === "optional") ? "optional" : void 0), w(e, "values", (e) => {
		if (e.def.options.every((e) => e._zod.values)) return new Set(e.def.options.flatMap((e) => Array.from(e._zod.values)));
	}), w(e, "pattern", (e) => {
		if (e.def.options.every((e) => e._zod.pattern)) {
			let t = e.def.options.map((e) => e._zod.pattern);
			return RegExp(`^(${t.map((e) => le(e.source)).join("|")})$`);
		}
	});
	let n = t.options.length === 1 ? t.options[0]._zod.run : null;
	e._zod.parse = (r, i) => {
		if (n) return n(r, i);
		let a = !1, o = [];
		for (let e of t.options) {
			let t = e._zod.run({
				value: r.value,
				issues: []
			}, i);
			if (t instanceof Promise) o.push(t), a = !0;
			else {
				if (t.issues.length === 0) return t;
				o.push(t);
			}
		}
		return a ? Promise.all(o).then((t) => Yr(t, r, e, i)) : Yr(o, r, e, i);
	};
});
function Zr(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.options) {
		let r = n._zod.propValues?.[e.discriminator];
		if (!r || r.size === 0) throw Error(`Invalid discriminated union option at index "${e.options.indexOf(n)}"`);
		for (let e of r) if (t.has(e)) {
			if (e !== void 0) throw Error(`Duplicate discriminator value "${String(e)}"`);
			t.set(e, null);
		} else t.set(e, n);
	}
	return t;
}
var Qr = /*@__PURE__*/ T("$ZodDiscriminatedUnion", (e, t) => {
	t.inclusive = !1, Xr.init(e, t);
	let n = e._zod.parse;
	w(e, "propValues", (e) => {
		let t = {}, n = 0;
		for (let r of e.def.options) {
			let i = r._zod.propValues;
			if (!i || Object.keys(i).length === 0) throw Error(`Invalid discriminated union option at index "${e.def.options.indexOf(r)}"`);
			i[e.def.discriminator]?.has(void 0) && n++;
			for (let [e, n] of Object.entries(i)) {
				Object.prototype.hasOwnProperty.call(t, e) || de(t, e, /* @__PURE__ */ new Set());
				for (let r of n) t[e].add(r);
			}
		}
		return !e.def.unionFallback && n > 1 && t[e.def.discriminator]?.delete(void 0), t;
	}), t.options.forEach((e, n) => {
		let r = fe(e._zod.def);
		if (r && !Object.prototype.hasOwnProperty.call(r, t.discriminator)) throw Error(`Invalid discriminated union option at index "${n}"`);
	});
	let r = se(() => Zr(t));
	e._zod.parse = (i, a) => {
		let o = i.value;
		if (!xe(o)) return i.issues.push({
			code: "invalid_type",
			expected: "object",
			input: o,
			inst: e
		}), i;
		let s = o?.[t.discriminator], c = r.value.get(s);
		return c && (s !== void 0 || a.direction !== "backward") ? c._zod.run(i, a) : t.unionFallback || a.direction === "backward" ? n(i, a) : (i.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			discriminator: t.discriminator,
			options: Array.from(r.value.keys()).filter((e) => r.value.get(e) !== null),
			input: o,
			path: [t.discriminator],
			inst: e
		}), i);
	};
}), $r = /*@__PURE__*/ T("$ZodIntersection", (e, t) => {
	D.init(e, t), e._zod.parse = (e, n) => {
		let r = e.value, i = t.left._zod.run({
			value: r,
			issues: []
		}, n), a = t.right._zod.run({
			value: r,
			issues: []
		}, n);
		return i instanceof Promise || a instanceof Promise ? Promise.all([i, a]).then(([t, n]) => ti(e, t, n)) : ti(e, i, a);
	};
});
function ei(e, t) {
	if (e === t || e instanceof Date && t instanceof Date && +e == +t) return {
		valid: !0,
		data: e
	};
	if (Ce(e) && Ce(t)) {
		let n = Object.keys(t), r = Object.keys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		Object.prototype.hasOwnProperty.call(i, "__proto__") && delete i.__proto__;
		for (let n of r) {
			if (n === "__proto__") continue;
			let r = ei(e[n], t[n]);
			if (!r.valid) return {
				valid: !1,
				mergeErrorPath: [n, ...r.mergeErrorPath]
			};
			i[n] = r.data;
		}
		return {
			valid: !0,
			data: i
		};
	}
	if (Array.isArray(e) && Array.isArray(t)) {
		if (e.length !== t.length) return {
			valid: !1,
			mergeErrorPath: []
		};
		let n = [];
		for (let r = 0; r < e.length; r++) {
			let i = e[r], a = t[r], o = ei(i, a);
			if (!o.valid) return {
				valid: !1,
				mergeErrorPath: [r, ...o.mergeErrorPath]
			};
			n.push(o.data);
		}
		return {
			valid: !0,
			data: n
		};
	}
	return {
		valid: !1,
		mergeErrorPath: []
	};
}
function ti(e, t, n) {
	let r = /* @__PURE__ */ new Map(), i, a = /* @__PURE__ */ new Map(), o = (e, t) => {
		let n;
		if (e.code === "unrecognized_keys" && !e.path?.length) i ??= e, n = e.keys;
		else if (e.code === "invalid_key" && e.origin === "record" && e.path?.length === 1) {
			let t = String(e.path[0]);
			a.has(t) || a.set(t, e), n = [t];
		} else return !1;
		for (let e of n) r.has(e) || r.set(e, {}), r.get(e)[t] = !0;
		return !0;
	};
	for (let n of t.issues) o(n, "l") || e.issues.push(n);
	for (let t of n.issues) o(t, "r") || e.issues.push(t);
	let s = [...r].filter(([, e]) => e.l && e.r).map(([e]) => e);
	if (s.length) {
		let t = i ? s.filter((e) => i.keys.includes(e)) : [];
		t.length && e.issues.push({
			...i,
			keys: t
		});
		for (let n of s) !t.includes(n) && a.has(n) && e.issues.push(a.get(n));
	}
	let c = ei(t.value, n.value);
	if (!c.valid) {
		if (Ve(e)) return e;
		throw Error(`Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`);
	}
	return e.value = c.data, e;
}
var ni = /*@__PURE__*/ T("$ZodRecord", (e, t) => {
	D.init(e, t);
	let n = _t.memoizer;
	n?.attach(e), e._zod.parse = (r, i) => {
		let a = r.value;
		if (!Ce(a)) return r.issues.push({
			expected: "record",
			code: "invalid_type",
			input: a,
			inst: e
		}), r;
		let o = [], s = t.keyType._zod.values;
		if (s && !t.partial) {
			r.value = n ? n.alloc(e, r, {}, i) : {};
			let c = /* @__PURE__ */ new Set();
			for (let n of s) if (typeof n == "string" || typeof n == "number" || typeof n == "symbol") {
				if (c.add(typeof n == "number" ? n.toString() : n), n === "__proto__") continue;
				let s = t.keyType._zod.run({
					value: n,
					issues: []
				}, i);
				if (s instanceof Promise) throw Error("Async schemas not supported in object keys currently");
				if (s.issues.length) {
					r.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: s.issues.map((e) => qe(e, i, vt())),
						input: n,
						path: [n],
						inst: e
					});
					continue;
				}
				let l = s.value;
				if (l === "__proto__") continue;
				let u = t.valueType._zod.run({
					value: a[n],
					issues: []
				}, i);
				u instanceof Promise ? o.push(u.then((e) => {
					e.issues.length && r.issues.push(...Ue(n, e.issues)), r.value[l] = e.value;
				})) : (u.issues.length && r.issues.push(...Ue(n, u.issues)), r.value[l] = u.value);
			}
			let l;
			for (let e in a) if (!c.has(e)) {
				if (t.mode === "loose") {
					if (e === "__proto__") continue;
					r.value[e] = a[e];
				} else l ??= [], l.push(e);
			}
			l && l.length > 0 && r.issues.push({
				code: "unrecognized_keys",
				input: a,
				inst: e,
				keys: l,
				continue: !0
			});
		} else {
			r.value = n ? n.alloc(e, r, {}, i) : {};
			let c;
			for (let n of Reflect.ownKeys(a)) {
				if (n === "__proto__" || !Object.prototype.propertyIsEnumerable.call(a, n)) continue;
				let l = t.keyType._zod.run({
					value: n,
					issues: []
				}, i);
				if (l instanceof Promise) throw Error("Async schemas not supported in object keys currently");
				if (typeof n == "string" && Cn.test(n) && l.issues.length) {
					let e = t.keyType._zod.run({
						value: Number(n),
						issues: []
					}, i);
					if (e instanceof Promise) throw Error("Async schemas not supported in object keys currently");
					e.issues.length === 0 && (l = e);
				}
				if (l.issues.length) {
					t.mode === "loose" ? r.value[n] = a[n] : s ? (c ??= [], c.push(n)) : r.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: l.issues.map((e) => qe(e, i, vt())),
						input: n,
						path: [n],
						inst: e
					});
					continue;
				}
				let u = l.value;
				if (u === "__proto__") continue;
				let d = t.valueType._zod.run({
					value: a[n],
					issues: []
				}, i);
				d instanceof Promise ? o.push(d.then((e) => {
					e.issues.length && r.issues.push(...Ue(n, e.issues)), r.value[u] = e.value;
				})) : (d.issues.length && r.issues.push(...Ue(n, d.issues)), r.value[u] = d.value);
			}
			c && c.length > 0 && r.issues.push({
				code: "unrecognized_keys",
				input: a,
				inst: e,
				keys: c,
				continue: !0
			});
		}
		return o.length ? Promise.all(o).then(() => r) : r;
	};
}), ri = /*@__PURE__*/ T("$ZodEnum", (e, t) => {
	D.init(e, t);
	let n = re(t.entries), r = new Set(n);
	e._zod.values = r, w(e, "pattern", (e) => {
		let t = re(e.def.entries).filter((e) => Te.has(typeof e));
		return RegExp(t.length ? `^(${t.map((e) => Ee(e.toString())).join("|")})$` : "^[^\\s\\S]$");
	}), e._zod.parse = (t, i) => {
		let a = t.value;
		return r.has(a) || t.issues.push({
			code: "invalid_value",
			values: n,
			input: a,
			inst: e
		}), t;
	};
}), ii = /*@__PURE__*/ T("$ZodLiteral", (e, t) => {
	D.init(e, t);
	let n = new Set(t.values);
	e._zod.values = n, w(e, "pattern", (e) => {
		let t = e.def.values;
		return RegExp(t.length ? `^(${t.map((e) => typeof e == "string" ? Ee(e) : e ? Ee(e.toString()) : String(e)).join("|")})$` : "^[^\\s\\S]$");
	}), e._zod.parse = (r, i) => {
		let a = r.value;
		return n.has(a) || r.issues.push({
			code: "invalid_value",
			values: t.values,
			input: a,
			inst: e
		}), r;
	};
}), ai = /*@__PURE__*/ T("$ZodTransform", (e, t) => {
	D.init(e, t), e._zod.optin = "optional", _t.memoizer?.guard(e), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new gt(e.constructor.name);
		let i = t.transform(n.value, n);
		if (r.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => (n.value = e, n));
		if (i instanceof Promise) throw new ht();
		return n.value = i, n;
	};
});
function oi(e, t) {
	return e.value = t.issues.length ? void 0 : t.value, e;
}
var si = /*@__PURE__*/ T("$ZodOptional", (e, t) => {
	D.init(e, t), w(e, "optin", (e) => e.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), e._zod.optout = "optional", w(e, "values", (e) => {
		let t = e.def.innerType._zod.values;
		return t ? /* @__PURE__ */ new Set([...t, void 0]) : void 0;
	}), w(e, "pattern", (e) => {
		let t = e.def.innerType._zod.pattern;
		return t ? RegExp(`^(${le(t.source)})?$`) : void 0;
	}), e._zod.parse = (e, n) => {
		if (e.value === void 0) {
			if (t.innerType._zod.optin !== "defaulted") return e;
			let r = t.innerType._zod.run({
				value: e.value,
				issues: []
			}, n);
			return r instanceof Promise ? r.then((t) => oi(e, t)) : oi(e, r);
		}
		return t.innerType._zod.run(e, n);
	};
}), ci = /*@__PURE__*/ T("$ZodExactOptional", (e, t) => {
	si.init(e, t), w(e, "values", (e) => e.def.innerType._zod.values), w(e, "pattern", (e) => e.def.innerType._zod.pattern), e._zod.parse = (e, n) => t.innerType._zod.run(e, n);
}), li = /*@__PURE__*/ T("$ZodNullable", (e, t) => {
	D.init(e, t), w(e, "optin", (e) => e.def.innerType._zod.optin), w(e, "optout", (e) => e.def.innerType._zod.optout), w(e, "pattern", (e) => {
		let t = e.def.innerType._zod.pattern;
		return t ? RegExp(`^(${le(t.source)}|null)$`) : void 0;
	}), w(e, "values", (e) => e.def.innerType._zod.values ? /* @__PURE__ */ new Set([...e.def.innerType._zod.values, null]) : void 0), e._zod.parse = (e, n) => e.value === null ? e : t.innerType._zod.run(e, n);
}), ui = /*@__PURE__*/ T("$ZodDefault", (e, t) => {
	D.init(e, t), e._zod.optin = "defaulted", w(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		if (e.value === void 0) return e.value = t.defaultValue, e;
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => di(e, t)) : di(r, t);
	};
});
function di(e, t) {
	return e.value === void 0 && (e.value = t.defaultValue), e;
}
var fi = /*@__PURE__*/ T("$ZodPrefault", (e, t) => {
	D.init(e, t), e._zod.optin = "defaulted", w(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => (n.direction === "backward" || e.value === void 0 && (e.value = t.defaultValue), t.innerType._zod.run(e, n));
}), pi = /*@__PURE__*/ T("$ZodNonOptional", (e, t) => {
	D.init(e, t), w(e, "values", (e) => {
		let t = e.def.innerType._zod.values;
		return t ? new Set([...t].filter((e) => e !== void 0)) : void 0;
	}), e._zod.parse = (n, r) => {
		let i = t.innerType._zod.run(n, r);
		return i instanceof Promise ? i.then((t) => mi(t, e)) : mi(i, e);
	};
});
function mi(e, t) {
	return !e.issues.length && e.value === void 0 && e.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: e.value,
		inst: t
	}), e;
}
function hi(e, t, n, r) {
	return t.issues.length ? (e.value = n.catchValue({
		...t,
		value: e.value,
		error: { issues: t.issues.map((e) => qe(e, r, vt())) },
		input: e.value
	}), e) : (e.value = t.value, t.memo && (e.memo = !0), e);
}
var gi = /*@__PURE__*/ T("$ZodCatch", (e, t) => {
	D.init(e, t), w(e, "optin", (e) => e.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), w(e, "optout", (e) => e.def.innerType._zod.optout), w(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run({
			value: e.value,
			issues: []
		}, n);
		return r instanceof Promise ? r.then((r) => hi(e, r, t, n)) : hi(e, r, t, n);
	};
}), _i = /*@__PURE__*/ T("$ZodPipe", (e, t) => {
	D.init(e, t), w(e, "values", (e) => e.def.in._zod.values), w(e, "optin", (e) => e.def.in._zod.optin), w(e, "optout", (e) => e.def.out._zod.optout), w(e, "propValues", (e) => e.def.in._zod.propValues), e._zod.parse = (e, n) => {
		if (n.direction === "backward") {
			let r = t.out._zod.run(e, n);
			return r instanceof Promise ? r.then((e) => vi(e, t.in, n)) : vi(r, t.in, n);
		}
		let r = t.in._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => vi(e, t.out, n)) : vi(r, t.out, n);
	};
});
function vi(e, t, n) {
	return e.issues.some((e) => e.code !== "unrecognized_keys") ? (e.aborted = !0, e) : t._zod.run({
		value: e.value,
		issues: e.issues
	}, n);
}
var yi = /*@__PURE__*/ T("$ZodReadonly", (e, t) => {
	D.init(e, t), w(e, "propValues", (e) => e.def.innerType._zod.propValues), w(e, "values", (e) => e.def.innerType._zod.values), w(e, "optin", (e) => e.def.innerType?._zod?.optin), w(e, "optout", (e) => e.def.innerType?._zod?.optout), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then(bi) : bi(r);
	};
});
function bi(e) {
	return e.memo || (e.value = Object.freeze(e.value)), e;
}
var xi = /*@__PURE__*/ T("$ZodCustom", (e, t) => {
	E.init(e, t), D.init(e, t), e._zod.parse = (e, t) => e, e._zod.check = (n) => {
		let r = n.value, i = t.fn(r);
		if (i instanceof Promise) return i.then((t) => Si(t, n, r, e));
		Si(i, n, r, e);
	};
});
function Si(e, t, n, r) {
	if (!e) {
		let e = {
			code: "custom",
			input: n,
			inst: r,
			path: [...r._zod.def.path ?? []],
			continue: !r._zod.def.abort
		};
		r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Qe(e));
	}
}
// node_modules/zod/v4/core/memoizer.js
var Ci = class extends Error {
	constructor() {
		super("Cannot parse a reference cycle that closes through a transform"), this.name = "ZodCyclicError";
	}
}, wi = "~memo", Ti = [];
function Ei(e) {
	return typeof e == "object" && !!e;
}
function Di(e) {
	return e.map((e) => e.path ? {
		...e,
		path: e.path.slice()
	} : { ...e });
}
var Oi = /*@__PURE__*/ new WeakMap(), ki = 0, Ai = 1, ji = 2;
function Mi(e, t, n) {
	let r = Oi.get(e);
	if (r !== void 0) return r ? ji : ki;
	if (t.has(e)) return ji;
	t.add(e);
	let i = ki, a = (e) => {
		if (i !== ji && e?._zod) {
			let r = Mi(e, t, n);
			r > i && (i = r);
		}
	}, o = (e, r) => {
		let i = ki;
		for (let a of Reflect.ownKeys(e)) {
			let o = Object.getOwnPropertyDescriptor(e, a);
			if (r && !o.enumerable) continue;
			let s = o.get ? Ai : o.value?._zod ? Mi(o.value, t, n) : ki;
			s > i && (i = s);
		}
		return i;
	}, s = (e) => {
		e > i && (i = e);
	}, c = e._zod.def;
	switch (c.type) {
		case "object": {
			let e = fe(c);
			s(e ? o(e, !0) : Ai), a(c.catchall);
			break;
		}
		case "array":
			a(c.element);
			break;
		case "tuple":
			for (let e of c.items) a(e);
			a(c.rest);
			break;
		case "record":
		case "map":
			a(c.keyType), a(c.valueType);
			break;
		case "set":
			a(c.valueType);
			break;
		case "union":
			for (let e of c.options) a(e);
			break;
		case "intersection":
			a(c.left), a(c.right);
			break;
		case "optional":
		case "nullable":
		case "default":
		case "prefault":
		case "catch":
		case "readonly":
		case "nonoptional":
		case "promise":
		case "success":
			a(c.innerType);
			break;
		case "pipe":
			a(c.in), a(c.out);
			break;
		case "function":
			a(c.input), a(c.output);
			break;
		case "lazy": {
			let r = c._cachedInner ?? (n ? e._zod.innerType : void 0);
			s(r ? Mi(r, t, !1) : Ai);
			break;
		}
		case "template_literal":
		case "string":
		case "number":
		case "int":
		case "boolean":
		case "bigint":
		case "symbol":
		case "undefined":
		case "null":
		case "void":
		case "never":
		case "any":
		case "unknown":
		case "date":
		case "nan":
		case "enum":
		case "literal":
		case "file":
		case "transform":
		case "custom": break;
		default: for (let e in c) {
			let t = Object.getOwnPropertyDescriptor(c, e);
			if (!t || t.get) continue;
			let n = t.value;
			if (n && typeof n == "object") {
				if (n._zod) a(n);
				else if (Array.isArray(n)) for (let e of n) a(e);
			}
		}
	}
	return t.delete(e), Ni(e, i);
}
function Ni(e, t) {
	return t !== Ai && Oi.set(e, t === ji), t;
}
function Pi(e, t) {
	let n = e.buckets.get(t);
	return n || (n = /* @__PURE__ */ new WeakMap(), e.buckets.set(t, n)), n;
}
var Fi, Ii = [], Li = {
	alloc(e, t, n) {
		let r = Fi;
		if (!r) return n;
		Fi = void 0;
		let i = {
			value: n,
			issues: null
		};
		return r.set(t.value, i), Ii.push(i), n;
	},
	guard(e) {
		var t;
		(t = e._zod).deferred ?? (t.deferred = []), e._zod.deferred.push(() => {
			let t = e._zod.parse, n = (e, n) => {
				if (n.direction !== "backward" && zi(n, e.value)) throw new Ci();
				return t(e, n);
			};
			e._zod.parse = n, e._zod.run === t && (e._zod.run = n);
		});
	},
	attach(e) {
		var t;
		let n, r = !1, i, a;
		(t = e._zod).deferred ?? (t.deferred = []), e._zod.deferred.push(() => {
			let t = e._zod.parse, o = (s, c) => {
				if (n === void 0) {
					let i = Mi(e, /* @__PURE__ */ new Set(), !1);
					if (i === ki) return e._zod.parse = t, e._zod.run === o && (e._zod.run = t), t(s, c);
					i === ji || r ? n = !0 : r = !0;
				}
				let l = s.value;
				if (!Ei(l)) return t(s, c);
				let u = c[wi];
				u || (u = {
					buckets: /* @__PURE__ */ new WeakMap(),
					backEdges: void 0
				}, c[wi] = u);
				let d;
				i === c ? d = a : (d = Pi(u, e), i = c, a = d);
				let f = d.get(l);
				if (f) return s.value = f.value, f.issues ? f.issues.length && s.issues.push(...Di(f.issues)) : (s.memo = !0, u.backEdges ?? (u.backEdges = /* @__PURE__ */ new WeakSet()), u.backEdges.add(f.value)), s;
				Fi = d;
				let p = Ii.length, m = t(s, c);
				Fi = void 0;
				let h = Ii.length > p ? Ii.pop() : void 0;
				return m instanceof Promise ? m.then((e) => (h && (h.issues = e.issues.length ? Di(e.issues) : Ti), e)) : (h && (h.issues = m.issues.length ? Di(m.issues) : Ti), m);
			};
			e._zod.parse = o, e._zod.run === t && (e._zod.run = o);
		});
	}
};
function Ri() {
	return Li;
}
function zi(e, t) {
	let n = e[wi]?.backEdges;
	return n !== void 0 && Ei(t) && n.has(t);
}
// node_modules/zod/v4/locales/en.js
var Bi = () => {
	let e = {
		string: {
			unit: "characters",
			verb: "to have"
		},
		file: {
			unit: "bytes",
			verb: "to have"
		},
		array: {
			unit: "items",
			verb: "to have"
		},
		set: {
			unit: "items",
			verb: "to have"
		},
		map: {
			unit: "entries",
			verb: "to have"
		}
	};
	function t(t) {
		return e[t] ?? null;
	}
	let n = {
		regex: "input",
		email: "email address",
		url: "URL",
		emoji: "emoji",
		uuid: "UUID",
		uuidv4: "UUIDv4",
		uuidv6: "UUIDv6",
		nanoid: "nanoid",
		guid: "GUID",
		cuid: "cuid",
		cuid2: "cuid2",
		ulid: "ULID",
		xid: "XID",
		ksuid: "KSUID",
		datetime: "ISO datetime",
		date: "ISO date",
		time: "ISO time",
		duration: "ISO duration",
		ipv4: "IPv4 address",
		ipv6: "IPv6 address",
		mac: "MAC address",
		cidrv4: "IPv4 range",
		cidrv6: "IPv6 range",
		base64: "base64-encoded string",
		base64url: "base64url-encoded string",
		json_string: "JSON string",
		e164: "E.164 number",
		currency_code: "currency code",
		credit_card: "credit card number",
		iban: "IBAN",
		jwt: "JWT",
		template_literal: "input"
	}, r = { nan: "NaN" };
	function i(e, t) {
		return e === "number" && typeof t == "number" && !Number.isFinite(t) ? String(t) : r[e] ?? e;
	}
	return (e) => {
		switch (e.code) {
			case "invalid_type": return `Invalid input: expected ${i(e.expected)}, received ${i(Ze(e.input), e.input)}`;
			case "invalid_value": return e.values.length === 1 ? `Invalid input: expected ${Oe(e.values[0])}` : `Invalid option: expected one of ${ie(e.values, "|")}`;
			case "too_big": {
				let n = e.exact ? "exactly " : e.inclusive ? "<=" : "<", r = t(e.origin);
				return r ? `Too big: expected ${e.origin ?? "value"} to have ${n}${e.maximum.toString()} ${r.unit ?? "elements"}` : `Too big: expected ${e.origin ?? "value"} to be ${n}${e.maximum.toString()}`;
			}
			case "too_small": {
				let n = e.exact ? "exactly " : e.inclusive ? ">=" : ">", r = t(e.origin);
				return r ? `Too small: expected ${e.origin} to have ${n}${e.minimum.toString()} ${r.unit}` : `Too small: expected ${e.origin} to be ${n}${e.minimum.toString()}`;
			}
			case "invalid_format": {
				let t = e;
				return t.format === "starts_with" ? `Invalid string: must start with "${t.prefix}"` : t.format === "ends_with" ? `Invalid string: must end with "${t.suffix}"` : t.format === "includes" ? `Invalid string: must include "${t.includes}"` : t.format === "regex" ? `Invalid string: must match pattern ${t.pattern}` : `Invalid ${n[t.format] ?? e.format}`;
			}
			case "not_multiple_of": return `Invalid number: must be a multiple of ${e.divisor}`;
			case "unrecognized_keys": return `Unrecognized key${e.keys.length > 1 ? "s" : ""}: ${ie(e.keys, ", ")}`;
			case "invalid_key": return `Invalid key in ${e.origin}`;
			case "invalid_union": return e.options && Array.isArray(e.options) && e.options.length > 0 ? `Invalid discriminator value. Expected ${e.options.map((e) => `'${e}'`).join(" | ")}` : e.inclusive === !1 ? "Invalid input: more than one option matched" : "Invalid input";
			case "invalid_element": return `Invalid value in ${e.origin}`;
			default: return "Invalid input";
		}
	};
};
function Vi() {
	return { localeError: Bi() };
}
// node_modules/zod/v4/core/registries.js
var Hi, Ui = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
	}
	add(e, ...t) {
		let n = t[0];
		return this._map.set(e, n), n && typeof n == "object" && "id" in n && this._idmap.set(n.id, e), this;
	}
	clear() {
		return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
	}
	remove(e) {
		let t = this._map.get(e);
		return t && typeof t == "object" && "id" in t && this._idmap.delete(t.id), this._map.delete(e), this;
	}
	get(e) {
		let t = e._zod.parent;
		if (t) {
			let n = { ...this.get(t) ?? {} };
			delete n.id;
			let r = {
				...n,
				...this._map.get(e)
			};
			return Object.keys(r).length ? r : void 0;
		}
		return this._map.get(e);
	}
	has(e) {
		return this._map.has(e);
	}
};
function Wi() {
	return new Ui();
}
(Hi = globalThis).__zod_globalRegistry ?? (Hi.__zod_globalRegistry = Wi());
var Gi = globalThis.__zod_globalRegistry;
// node_modules/zod/v4/core/api.js
function Ki(e) {
	return e.checks &&= [...e.checks], e;
}
// @__NO_SIDE_EFFECTS__
function qi(e, t) {
	return new e(Ki({
		type: "string",
		...C(t)
	}));
}
// @__NO_SIDE_EFFECTS__
function Ji(e, t) {
	return new e({
		type: "string",
		format: "email",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Yi(e, t) {
	return new e({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Xi(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Zi(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v4",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Qi(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v6",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function $i(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v7",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ea(e, t) {
	return new e({
		type: "string",
		format: "url",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ta(e, t) {
	return new e({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function na(e, t) {
	return new e({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ra(e, t) {
	return new e({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ia(e, t) {
	return new e({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function aa(e, t) {
	return new e({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function oa(e, t) {
	return new e({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function sa(e, t) {
	return new e({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ca(e, t) {
	return new e({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function la(e, t) {
	return new e({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ua(e, t) {
	return new e({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function da(e, t) {
	return new e({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function fa(e, t) {
	return new e({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function pa(e, t) {
	return new e({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ma(e, t) {
	return new e({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ha(e, t) {
	return new e({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ga(e, t) {
	return new e({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: !1,
		local: !1,
		precision: null,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function _a(e, t) {
	return new e({
		type: "string",
		format: "date",
		check: "string_format",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function va(e, t) {
	return new e({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ya(e, t) {
	return new e({
		type: "string",
		format: "duration",
		check: "string_format",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ba(e, t) {
	return new e(Ki({
		type: "number",
		checks: [],
		...C(t)
	}));
}
// @__NO_SIDE_EFFECTS__
function xa(e, t) {
	return new e({
		type: "number",
		check: "number_format",
		abort: !1,
		format: "safeint",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Sa(e, t) {
	return new e({
		type: "boolean",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ca(e) {
	return new e({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function wa(e, t) {
	return new e({
		type: "never",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ta(e, t) {
	return new kn({
		check: "less_than",
		...C(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function Ea(e, t) {
	return new kn({
		check: "less_than",
		...C(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function Da(e, t) {
	return new An({
		check: "greater_than",
		...C(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function Oa(e, t) {
	return new An({
		check: "greater_than",
		...C(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function ka(e, t) {
	return new jn({
		check: "multiple_of",
		...C(t),
		value: e
	});
}
// @__NO_SIDE_EFFECTS__
function Aa(e, t) {
	return new Nn({
		check: "max_length",
		...C(t),
		maximum: e
	});
}
// @__NO_SIDE_EFFECTS__
function ja(e, t) {
	return new Pn({
		check: "min_length",
		...C(t),
		minimum: e
	});
}
// @__NO_SIDE_EFFECTS__
function Ma(e, t) {
	return new Fn({
		check: "length_equals",
		...C(t),
		length: e
	});
}
// @__NO_SIDE_EFFECTS__
function Na(e, t) {
	return new Ln({
		check: "string_format",
		format: "regex",
		...C(t),
		pattern: e
	});
}
// @__NO_SIDE_EFFECTS__
function Pa(e) {
	return new Rn({
		check: "string_format",
		format: "lowercase",
		...C(e)
	});
}
// @__NO_SIDE_EFFECTS__
function Fa(e) {
	return new zn({
		check: "string_format",
		format: "uppercase",
		...C(e)
	});
}
// @__NO_SIDE_EFFECTS__
function Ia(e, t) {
	return new Bn({
		check: "string_format",
		format: "includes",
		...C(t),
		includes: e
	});
}
// @__NO_SIDE_EFFECTS__
function La(e, t) {
	return new Vn({
		check: "string_format",
		format: "starts_with",
		...C(t),
		prefix: e
	});
}
// @__NO_SIDE_EFFECTS__
function Ra(e, t) {
	return new Hn({
		check: "string_format",
		format: "ends_with",
		...C(t),
		suffix: e
	});
}
// @__NO_SIDE_EFFECTS__
function za(e) {
	return new Un({
		check: "overwrite",
		tx: e
	});
}
// @__NO_SIDE_EFFECTS__
function Ba(e) {
	return /* @__PURE__ */ za((t) => t.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function Va() {
	return /* @__PURE__ */ za((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function Ha() {
	return /* @__PURE__ */ za((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function Ua() {
	return /* @__PURE__ */ za((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function Wa() {
	return /* @__PURE__ */ za((e) => ye(e));
}
// @__NO_SIDE_EFFECTS__
function Ga(e, t, n) {
	return new e({
		type: "array",
		element: t,
		...C(n)
	});
}
// @__NO_SIDE_EFFECTS__
function Ka(e, t, n) {
	let r = C(n);
	return r.abort ??= !0, new e({
		type: "custom",
		check: "custom",
		fn: t,
		...r
	});
}
// @__NO_SIDE_EFFECTS__
function qa(e, t, n) {
	return new e({
		type: "custom",
		check: "custom",
		fn: t,
		...C(n)
	});
}
// @__NO_SIDE_EFFECTS__
function Ja(e, t) {
	let n = /* @__PURE__ */ Ya((t) => (t.addIssue = (e) => {
		if (typeof e == "string") t.issues.push(Qe(e, t.value, n._zod.def));
		else {
			let r = e;
			r.fatal && (r.continue = !1), r.code ??= "custom", "input" in r || (r.input = t.value), r.inst ??= n, r.continue ??= !n._zod.def.abort, t.issues.push(Qe(r));
		}
	}, e(t.value, t)), t);
	return n;
}
// @__NO_SIDE_EFFECTS__
function Ya(e, t) {
	let n = new E({
		check: "custom",
		...C(t)
	});
	return n._zod.check = e, n;
}
// node_modules/zod/v4/core/to-json-schema.js
function Xa(e, ...t) {
	for (let n of t) for (let t of Reflect.ownKeys(n)) Object.prototype.propertyIsEnumerable.call(n, t) && de(e, t, n[t]);
	return e;
}
function Za(e) {
	let t = e?.target ?? "draft-2020-12";
	return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
		processors: e.processors ?? {},
		metadataRegistry: e?.metadata ?? Gi,
		target: t,
		unrepresentable: e?.unrepresentable ?? "throw",
		override: e?.override ?? (() => {}),
		io: e?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		sharedDefsExtractedFor: void 0,
		sharedEmitDoneFor: void 0,
		cycles: e?.cycles ?? "ref",
		reused: e?.reused ?? "inline",
		intersections: [],
		deferred: [],
		external: e?.external ?? void 0
	};
}
function Qa(e, t, n, r, i) {
	let a = typeof t.unrepresentable == "function" ? t.unrepresentable({
		zodSchema: e,
		path: r.path,
		message: i
	}) : t.unrepresentable;
	if (a === "any") return !1;
	if (a === void 0 || a === "throw") throw Error(i);
	return Object.assign(n, a), !0;
}
function k(e, t, n = {
	path: [],
	schemaPath: []
}) {
	var r;
	let i = e._zod.def, a = t.seen.get(e);
	if (a) return a.count++, n.schemaPath.includes(e) && (a.cycle = n.path), a.schema;
	let o = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: n.path
	};
	t.seen.set(e, o), t.sharedDefsExtractedFor = void 0, t.sharedEmitDoneFor = void 0;
	let s = e._zod.toJSONSchema?.();
	if (s) o.schema = s;
	else {
		let r = {
			...n,
			schemaPath: [...n.schemaPath, e],
			path: n.path
		};
		if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, o.schema, r);
		else {
			let n = o.schema, a = t.processors[i.type];
			if (!a) throw Error(`[toJSONSchema]: Non-representable type encountered: ${i.type}`);
			a(e, t, n, r);
		}
		let a = e._zod.parent;
		a && (o.ref ||= a, k(a, t, r), t.seen.get(a).isParent = !0);
	}
	let c = t.metadataRegistry.get(e);
	return c && Xa(o.schema, c), t.io === "input" && A(e) && (delete o.schema.examples, delete o.schema.default), t.io === "input" && "_prefault" in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)), delete o.schema._prefault, t.seen.get(e).schema;
}
function $a(e) {
	return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
function eo(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	if (e.external && e.sharedDefsExtractedFor === e.external) return;
	let r = /* @__PURE__ */ new Map();
	for (let t of e.seen.entries()) {
		let n = e.metadataRegistry.get(t[0])?.id;
		if (n) {
			let e = r.get(n);
			if (e && e !== t[0]) throw Error(`Duplicate schema id "${n}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			r.set(n, t[0]);
		}
	}
	let i = (t) => {
		let r = e.target === "draft-2020-12" ? "$defs" : "definitions";
		if (e.external) {
			let n = e.external.registry.get(t[0])?.id, i = e.external.uri ?? ((e) => e);
			if (n) return { ref: i(n) };
			let a = t[1].defId ?? t[1].schema.id ?? `schema${e.counter++}`;
			return t[1].defId = a, {
				defId: a,
				ref: `${i("__shared")}#/${r}/${$a(a)}`
			};
		}
		let i = `#/${r}/`;
		if (t[1] === n && !t[1].schema.id) return { ref: "#" };
		let a = t[1].schema.id ?? `__schema${e.counter++}`;
		return {
			defId: a,
			ref: i + $a(a)
		};
	}, a = (e) => {
		if (e[1].schema.$ref) return;
		let t = e[1], { ref: n, defId: r } = i(e);
		t.def = { ...t.schema }, r && (t.defId = r);
		let a = t.schema;
		for (let e in a) delete a[e];
		a.$ref = n;
	};
	if (e.cycles === "throw") for (let t of e.seen.entries()) {
		let e = t[1];
		if (e.cycle) throw Error(`Cycle detected: #/${e.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (let n of e.seen.entries()) {
		let r = n[1];
		if (t === n[0]) a(n);
		else {
			if (e.external) {
				let r = e.external.registry.get(n[0])?.id;
				if (t !== n[0] && r) {
					a(n);
					continue;
				}
			}
			(e.metadataRegistry.get(n[0])?.id || r.cycle || r.count > 1 && e.reused === "ref") && a(n);
		}
	}
	e.external && (e.sharedDefsExtractedFor = e.external);
}
function to(e) {
	let t = e.anyOf;
	if (!Array.isArray(t) || t.length === 0 || e.type !== void 0) return;
	let n = [];
	for (let e of t) {
		if (!e || typeof e != "object") return;
		to(e);
		let t = Object.keys(e);
		if (t.length !== 1 || t[0] !== "type") return;
		let r = e.type;
		for (let e of Array.isArray(r) ? r : [r]) {
			if (typeof e != "string") return;
			n.includes(e) || n.push(e);
		}
	}
	delete e.anyOf, e.type = n.length === 1 ? n[0] : n;
}
var no = /* @__PURE__ */ new Set([
	"type",
	"properties",
	"required",
	"additionalProperties"
]), ro = ["oneOf", "anyOf"];
function io(e) {
	let t = e.additionalProperties;
	return t === void 0 || t === !1 || typeof t != "object" || !t ? null : Object.keys(t).length ? t : null;
}
function ao(e) {
	let t = [];
	for (let n of e) {
		if (typeof n != "object" || n.type !== "object") return null;
		for (let e in n) if (!no.has(e)) return null;
		t.push(n);
	}
	let n = {}, r = /* @__PURE__ */ new Set();
	for (let e of t) {
		for (let r in e.properties) {
			if (Object.prototype.hasOwnProperty.call(n, r)) continue;
			let e = [];
			for (let n of t) {
				let t = n.properties?.[r] ?? io(n);
				t != null && (e.some((e) => JSON.stringify(e) === JSON.stringify(t)) || e.push(t));
			}
			de(n, r, e.length === 1 ? e[0] : ao(e) ?? { allOf: e });
		}
		for (let t of e.required ?? []) r.add(t);
	}
	let i = {
		type: "object",
		properties: n
	};
	if (r.size && (i.required = [...r]), t.every((e) => e.additionalProperties === !1)) i.additionalProperties = !1;
	else {
		let e = [];
		for (let n of t) {
			let t = io(n);
			t && !e.some((e) => JSON.stringify(e) === JSON.stringify(t)) && e.push(t);
		}
		e.length === 1 ? i.additionalProperties = e[0] : e.length > 1 && (i.additionalProperties = { allOf: e });
	}
	return i;
}
function oo(e) {
	let t = e.allOf;
	if (!Array.isArray(t) || t.length < 2) return;
	for (let t of no) if (t in e) return;
	let n = t.filter((e) => ro.some((t) => Array.isArray(e[t]))), r = null;
	if (!n.length) r = ao(t);
	else {
		let e = n[0], i = ro.find((t) => Array.isArray(e[t]));
		if (Object.keys(e).length !== 1) return;
		let a = t.filter((t) => t !== e), o = e[i].map((e) => ao([...a, e]));
		if (o.some((e) => !e)) return;
		r = { [i]: o };
	}
	r && (delete e.allOf, Xa(e, r));
}
function so(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	let r = (t) => {
		let n = e.seen.get(t);
		if (n.ref === null) return;
		let i = n.def ?? n.schema, a = { ...i }, o = n.ref;
		if (n.ref = null, o) {
			r(o);
			let n = e.seen.get(o), s = n.schema;
			if (s.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (i.allOf = i.allOf ?? [], i.allOf.push(s)) : Xa(i, s), Xa(i, a), t._zod.parent === o) for (let e in i) e !== "$ref" && e !== "allOf" && (e in a || delete i[e]);
			if (s.$ref && n.def) for (let e in i) e !== "$ref" && e !== "allOf" && e in n.def && JSON.stringify(i[e]) === JSON.stringify(n.def[e]) && delete i[e];
		}
		let s = t._zod.parent;
		if (s && s !== o) {
			r(s);
			let t = e.seen.get(s);
			if (t?.schema.$ref && (i.$ref = t.schema.$ref, t.def)) for (let e in i) e !== "$ref" && e !== "allOf" && e in t.def && JSON.stringify(i[e]) === JSON.stringify(t.def[e]) && delete i[e];
		}
		e.override({
			zodSchema: t,
			jsonSchema: i,
			path: n.path ?? []
		});
	};
	if (!e.external || e.sharedEmitDoneFor !== e.external) {
		for (let t of [...e.seen.entries()].reverse()) r(t[0]);
		if (e.target !== "openapi-3.0") for (let t of e.seen.entries()) to(t[1].def ?? t[1].schema);
		for (let t of e.deferred) t();
		if (e.intersections.length) {
			let t = /* @__PURE__ */ new Map();
			for (let n of e.seen.values()) for (let e of [n.schema, n.def]) {
				let n = e?.allOf;
				if (!Array.isArray(n)) continue;
				let r = t.get(n);
				r ? r.push(e) : t.set(n, [e]);
			}
			for (let n of e.intersections) for (let e of t.get(n) ?? []) oo(e);
		}
	}
	let i = {};
	if (e.target === "draft-2020-12" ? i.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? i.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? i.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
		let n = e.external.registry.get(t)?.id;
		if (!n) throw Error("Schema is missing an `id` property");
		i.$id = e.external.uri(n);
	}
	Xa(i, n.defId ? n.schema : n.def ?? n.schema);
	let a = e.metadataRegistry.get(t)?.id;
	a !== void 0 && i.id === a && delete i.id;
	let o = e.external?.defs ?? {};
	if (!e.external || e.sharedEmitDoneFor !== e.external) for (let t of e.seen.entries()) {
		let e = t[1];
		e.def && e.defId && (e.def.id === e.defId && delete e.def.id, de(o, e.defId, e.def));
	}
	e.external && (e.sharedEmitDoneFor = e.external), e.external || Object.keys(o).length > 0 && (e.target === "draft-2020-12" ? i.$defs = o : i.definitions = o);
	try {
		let n = JSON.parse(JSON.stringify(i));
		return Object.defineProperty(n, "~standard", {
			value: {
				...t["~standard"],
				jsonSchema: {
					input: lo(t, "input", e.processors),
					output: lo(t, "output", e.processors)
				}
			},
			enumerable: !1,
			writable: !1
		}), n;
	} catch {
		throw Error("Error converting schema to JSON.");
	}
}
function A(e, t) {
	let n = t ?? { seen: /* @__PURE__ */ new Set() };
	if (n.seen.has(e)) return !1;
	n.seen.add(e);
	let r = e._zod.def;
	if (r.type === "transform") return !0;
	if (r.type === "array") return A(r.element, n);
	if (r.type === "set") return A(r.valueType, n);
	if (r.type === "lazy") return A(r.getter(), n);
	if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault" || r.type === "catch") return A(r.innerType, n);
	if (r.type === "intersection") return A(r.left, n) || A(r.right, n);
	if (r.type === "record" || r.type === "map") return A(r.keyType, n) || A(r.valueType, n);
	if (r.type === "pipe") return e._zod.traits.has("$ZodCodec") ? !0 : A(r.in, n) || A(r.out, n);
	if (r.type === "object") {
		for (let e in r.shape) if (A(r.shape[e], n)) return !0;
		return !1;
	}
	if (r.type === "union") {
		for (let e of r.options) if (A(e, n)) return !0;
		return !1;
	}
	if (r.type === "tuple") {
		for (let e of r.items) if (A(e, n)) return !0;
		return !!(r.rest && A(r.rest, n));
	}
	return !1;
}
var co = (e, t = {}) => (n) => {
	let r = Za({
		...n,
		processors: t
	});
	return k(e, r), eo(r, e), so(r, e);
}, lo = (e, t, n = {}) => (r) => {
	let { libraryOptions: i, target: a } = r ?? {}, o = Za({
		...i ?? {},
		target: a,
		io: t,
		processors: n
	});
	return k(e, o), eo(o, e), so(o, e);
}, uo = (e, t, n) => {
	(e[t] === void 0 || n > e[t]) && (e[t] = n);
}, fo = (e, t, n) => {
	(e[t] === void 0 || n < e[t]) && (e[t] = n);
}, po = (e, t) => {
	uo(e, "minimum", t), fo(e, "maximum", t);
}, mo = (e, t) => {
	e.multipleOf ??= [], e.multipleOf.includes(t) || e.multipleOf.push(t);
}, ho = (e, t) => {
	e.patterns ??= /* @__PURE__ */ new Set(), e.patterns.add(t);
}, go = (e, t) => {
	e.mime = e.mime ? e.mime.filter((e) => t.includes(e)) : [...t];
}, _o = (e, t) => {
	e.format = t, t.includes("int") && (e.isInt = !0);
}, vo = (e, t) => uo(e, "minimum", t.minimum), yo = (e, t) => fo(e, "maximum", t.maximum), bo = (e) => (t, n) => {
	_o(t, n.format);
	let [r, i] = e[n.format];
	uo(t, "minimum", r), fo(t, "maximum", i);
}, xo = {
	greater_than: (e, t) => uo(e, t.inclusive ? "minimum" : "exclusiveMinimum", t.value),
	less_than: (e, t) => fo(e, t.inclusive ? "maximum" : "exclusiveMaximum", t.value),
	multiple_of: (e, t) => mo(e, t.value),
	number_format: bo(Ae),
	bigint_format: bo(je),
	min_length: vo,
	max_length: yo,
	length_equals: (e, t) => po(e, t.length),
	min_size: vo,
	max_size: yo,
	size_equals: (e, t) => po(e, t.size),
	string_format: (e, t) => {
		_o(e, t.format), t.pattern && ho(e, t.pattern), (t.format === "base64" || t.format === "base64url") && (e.contentEncoding = t.format), (t.local || t.precision === -1) && (e.laxFormat = !0);
	},
	mime_type: (e, t) => go(e, t.mime)
};
function So(e) {
	let t = {}, n = e._zod.def, r = e._zod.traits.has("$ZodCheck") ? [e, ...n.checks ?? []] : n.checks ?? [];
	for (let e of r) xo[e._zod.def.check]?.(t, e._zod.def);
	let i = e._zod.bag;
	i.minimum !== void 0 && uo(t, "minimum", i.minimum), i.exclusiveMinimum !== void 0 && uo(t, "exclusiveMinimum", i.exclusiveMinimum), i.maximum !== void 0 && fo(t, "maximum", i.maximum), i.exclusiveMaximum !== void 0 && fo(t, "exclusiveMaximum", i.exclusiveMaximum), i.multipleOf !== void 0 && mo(t, i.multipleOf), i.format !== void 0 && (t.format ??= i.format, i.format.includes("int") && (t.isInt = !0)), i.mime && go(t, i.mime);
	for (let e of i.patterns ?? []) ho(t, e);
	return t;
}
var Co = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
}, wo = /* @__PURE__ */ new Map([[Er, dn], [Or, fn]]), To = (e) => wo.get(e) ?? e, Eo = (e, t, n, r) => {
	let i = n;
	i.type = "string";
	let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l, laxFormat: u } = So(e);
	if (typeof a == "number" && (i.minLength = a), typeof o == "number" && (i.maxLength = o), s && (i.format = Co[s] ?? s, i.format === "" && delete i.format, (s === "time" || u) && delete i.format), l && (i.contentEncoding = l), c && c.size > 0) {
		let e = [...c].map(To);
		e.length === 1 ? i.pattern = e[0].source : e.length > 1 && (i.allOf = [...e.map((e) => ({
			...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: e.source
		}))]);
	}
}, Do = (e, t, n, r) => {
	let i = n, { minimum: a, maximum: o, multipleOf: s, exclusiveMaximum: c, exclusiveMinimum: l, isInt: u } = So(e);
	i.type = u ? "integer" : "number";
	let d = typeof l == "number" && l >= (a ?? -Infinity), f = typeof c == "number" && c <= (o ?? Infinity), p = t.target === "draft-04" || t.target === "openapi-3.0";
	if (d ? p ? (i.minimum = l, i.exclusiveMinimum = !0) : i.exclusiveMinimum = l : typeof a == "number" && (i.minimum = a), f ? p ? (i.maximum = c, i.exclusiveMaximum = !0) : i.exclusiveMaximum = c : typeof o == "number" && (i.maximum = o), s) {
		let n = /* @__PURE__ */ new Set();
		for (let a of s) Number.isFinite(a) && a !== 0 ? n.add(Math.abs(a)) : Qa(e, t, i, r, `A multipleOf divisor of ${a} cannot be represented in JSON Schema`);
		let [a, ...o] = n;
		a !== void 0 && (i.multipleOf = a), o.length && (i.allOf = [...i.allOf ?? [], ...o.map((e) => ({ multipleOf: e }))]);
	}
}, Oo = (e, t, n, r) => {
	n.type = "boolean";
}, ko = (e, t, n, r) => {
	n.not = {};
}, Ao = (e, t, n, r) => {
	let i = e._zod.def, a = re(i.entries);
	a.length === 0 ? n.not = {} : (a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), n.enum = a);
}, jo = (e, t, n, r) => {
	let i = e._zod.def;
	if (i.values.length === 0) {
		n.not = {};
		return;
	}
	let a = [];
	for (let o of i.values) if (o === void 0) {
		if (Qa(e, t, n, r, "Literal `undefined` cannot be represented in JSON Schema")) return;
	} else if (typeof o == "bigint") {
		if (Qa(e, t, n, r, "BigInt literals cannot be represented in JSON Schema")) return;
		a.push(Number(o));
	} else a.push(o);
	if (a.length !== 0) {
		if (a.length === 1) {
			let e = a[0];
			n.type = e === null ? "null" : typeof e, t.target === "draft-04" || t.target === "openapi-3.0" ? n.enum = [e] : n.const = e;
		} else a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), a.every((e) => typeof e == "boolean") && (n.type = "boolean"), a.every((e) => e === null) && (n.type = "null"), n.enum = a;
	}
}, Mo = (e, t, n, r) => {
	Qa(e, t, n, r, "Custom types cannot be represented in JSON Schema");
}, No = (e, t, n, r) => {
	Qa(e, t, n, r, "Transforms cannot be represented in JSON Schema");
}, Po = (e, t, n, r) => {
	let i = n, a = e._zod.def, { minimum: o, maximum: s } = So(e);
	typeof o == "number" && (i.minItems = o), typeof s == "number" && (i.maxItems = s), i.type = "array", i.items = k(a.element, t, {
		...r,
		path: [...r.path, "items"]
	});
};
function Fo(e) {
	let t = e._zod.def;
	return t.type === "pipe" && t.in._zod.traits.has("$ZodTransform") ? Fo(t.out) : t.type === "catch" ? Fo(t.innerType) : e._zod.optin;
}
var Io = (e, t, n, r) => {
	let i = n, a = e._zod.def, o = a.shape;
	if (Object.getOwnPropertySymbols(o).length && Qa(e, t, i, r, "Symbol keys cannot be represented in JSON Schema")) return;
	i.type = "object", i.properties = {};
	for (let e in o) de(i.properties, e, k(o[e], t, {
		...r,
		path: [
			...r.path,
			"properties",
			e
		]
	}));
	let s = [];
	for (let e of Object.keys(o)) {
		let n = a.shape[e];
		(t.io === "input" ? Fo(n) === void 0 : n._zod.optout === void 0) && s.push(e);
	}
	s.length > 0 && (i.required = s), a.catchall?._zod.def.type === "never" ? i.additionalProperties = !1 : a.catchall ? a.catchall && (i.additionalProperties = k(a.catchall, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	})) : t.io === "output" && (i.additionalProperties = !1);
}, Lo = (e, t, n, r) => {
	let i = e._zod.def, a = i.inclusive === !1, o = i.options.map((e, n) => k(e, t, {
		...r,
		path: [
			...r.path,
			a ? "oneOf" : "anyOf",
			n
		]
	}));
	a ? n.oneOf = o : n.anyOf = o;
}, Ro = (e, t, n, r) => {
	let i = e._zod.def, a = k(i.left, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			0
		]
	}), o = k(i.right, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			1
		]
	}), s = (e) => "allOf" in e && Object.keys(e).length === 1, c = [...s(a) ? a.allOf : [a], ...s(o) ? o.allOf : [o]];
	n.allOf = c, t.intersections.push(c);
};
function zo(e, t, n) {
	if (t.$ref) {
		if (n.has(t)) return t;
		n.add(t);
		let r = e.get(t)?.def;
		if (!r) return t;
		let i = zo(e, r, n);
		return i === r ? t : i;
	}
	for (let r of ["anyOf", "oneOf"]) {
		let i = t[r];
		if (!Array.isArray(i)) continue;
		let a = i.map((t) => zo(e, t, n));
		a.some((e, t) => e !== i[t]) && (t = {
			...t,
			[r]: a
		});
	}
	let r = Array.isArray(t.type) ? t.type : [t.type], i = !r.includes("string") && r.some((e) => e === "number" || e === "integer"), a = t.enum ?? (t.const === void 0 ? void 0 : [t.const]);
	if (!i && !a?.some((e) => typeof e == "number")) return t;
	let { minimum: o, maximum: s, exclusiveMinimum: c, exclusiveMaximum: l, multipleOf: u, format: d, id: f, ...p } = t;
	return p.enum ? p.enum = p.enum.map((e) => typeof e == "number" ? String(e) : e) : typeof p.const == "number" && (p.const = String(p.const)), i && (p.type = "string", a || (p.pattern = (r.includes("number") ? Cn : Sn).source)), p;
}
var Bo = /* @__PURE__ */ new WeakMap();
function Vo(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.seen.values()) n.def && !t.has(n.schema) && t.set(n.schema, n);
	let n = /* @__PURE__ */ new Map();
	for (let r of Bo.get(e) ?? []) {
		let i = e.seen.get(r), a = (i?.def ?? i?.schema)?.propertyNames;
		if (!a || a === !0 || n.has(a)) continue;
		let o = zo(t, a, /* @__PURE__ */ new Set());
		o !== a && n.set(a, o);
	}
	if (n.size) for (let t of e.seen.values()) for (let e of [t.schema, t.def]) {
		let t = e && n.get(e.propertyNames);
		t && (e.propertyNames = t);
	}
}
var Ho = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object";
	let o = a.keyType, s = So(o).patterns;
	if (a.mode === "loose" && s && s.size > 0) {
		let e = k(a.valueType, t, {
			...r,
			path: [
				...r.path,
				"patternProperties",
				"*"
			]
		});
		i.patternProperties = {};
		for (let t of s) de(i.patternProperties, To(t).source, e);
	} else {
		if (t.target === "draft-07" || t.target === "draft-2020-12") {
			i.propertyNames = k(a.keyType, t, {
				...r,
				path: [...r.path, "propertyNames"]
			});
			let n = Bo.get(t);
			n || (n = [], Bo.set(t, n), t.deferred.push(() => Vo(t))), n.push(e);
		}
		i.additionalProperties = k(a.valueType, t, {
			...r,
			path: [...r.path, "additionalProperties"]
		});
	}
	let c = o._zod.values, l = t.io === "input" && Fo(a.valueType) !== void 0;
	if (c && !a.partial && !l) {
		let e = [...c].filter((e) => typeof e == "string" || typeof e == "number");
		e.length > 0 && (i.required = e.map(String));
	}
}, Uo = (e, t, n, r) => {
	let i = e._zod.def, a = k(i.innerType, t, r), o = t.seen.get(e);
	t.target === "openapi-3.0" ? (o.ref = i.innerType, n.nullable = !0) : n.anyOf = [a, { type: "null" }];
}, Wo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Go = Symbol();
function Ko(e, t, n, r, i) {
	let a = !1, o = JSON.stringify(e, (e, t) => typeof t == "bigint" ? (a = !0, null) : t);
	return a ? (Qa(t, n, r, i, "BigInt defaults cannot be represented in JSON Schema"), Go) : JSON.parse(o);
}
var qo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o = Ko(i.defaultValue, e, t, n, r);
	o !== Go && (n.default = o);
}, Jo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	if (a.ref = i.innerType, t.io !== "input") return;
	let o = Ko(i.defaultValue, e, t, n, r);
	o !== Go && (n._prefault = o);
}, Yo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o;
	try {
		o = i.catchValue(void 0);
	} catch {
		Qa(e, t, n, r, "Dynamic catch values are not supported in JSON Schema");
		return;
	}
	n.default = o;
}, Xo = (e, t, n, r) => {
	let i = e._zod.def, a = i.in._zod.traits.has("$ZodTransform"), o = t.io === "input" ? a ? i.out : i.in : i.out;
	k(o, t, r);
	let s = t.seen.get(e);
	s.ref = o;
}, Zo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.readOnly = !0;
}, Qo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, $o = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function es(e, t, n) {
	Object.defineProperty(e, t, {
		configurable: !0,
		enumerable: !1,
		get() {
			let e = n(this);
			return Object.defineProperty(this, t, {
				value: e,
				configurable: !0,
				writable: !0
			}), e;
		},
		set(e) {
			Object.defineProperty(this, t, {
				value: e,
				configurable: !0,
				writable: !0
			});
		}
	});
}
var j = /*@__PURE__*/ T("ZodError", (e, t) => {
	wt.init(e, t), e.name = "ZodError";
	let n = Object.getPrototypeOf(e);
	$o.has(n) || ($o.add(n), es(n, "format", (e) => (t) => Dt(e, t)), es(n, "flatten", (e) => (t) => Et(e, t)), es(n, "addIssue", (e) => (t) => {
		e.issues.push(t), e.message = JSON.stringify(e.issues, ae, 2);
	}), es(n, "addIssues", (e) => (t) => {
		e.issues.push(...t), e.message = JSON.stringify(e.issues, ae, 2);
	}), Object.defineProperty(n, "isEmpty", {
		configurable: !0,
		enumerable: !1,
		get() {
			return this.issues.length === 0;
		}
	}));
}, void 0, { Parent: Error }), ts = /* @__PURE__ */ kt(j), ns = /* @__PURE__ */ At(j), rs = /* @__PURE__ */ jt(j), is = /* @__PURE__ */ Nt(j), as = /* @__PURE__ */ zt(j), os = /* @__PURE__ */ Bt(j), ss = /* @__PURE__ */ Vt(j), cs = /* @__PURE__ */ Ht(j), ls = /* @__PURE__ */ Ut(j), us = /* @__PURE__ */ Wt(j), ds = /* @__PURE__ */ Gt(j), fs = /* @__PURE__ */ Kt(j);
// node_modules/zod/v4/classic/schemas.js
function ps() {
	_t.localeError || vt(Vi());
}
function ms() {
	_t.memoizer || vt({ memoizer: Ri() });
}
var M = /*@__PURE__*/ T("ZodType", (e, t) => (ps(), D.init(e, t), e.def = t, e.type = t.type, e), {
	check(...e) {
		let t = this.def;
		return this.clone(S(t, { checks: [...t.checks ?? [], ...e.map((e) => typeof e == "function" ? { _zod: {
			check: e,
			def: { check: "custom" },
			onattach: []
		} } : e)] }), { parent: !0 });
	},
	with(...e) {
		return this.check(...e);
	},
	clone(e, t) {
		return De(this, e, t);
	},
	brand() {
		return this;
	},
	register(e, t) {
		return e.add(this, t), this;
	},
	refine(e, t) {
		return this.check(jc(e, t));
	},
	superRefine(e, t) {
		return this.check(Mc(e, t));
	},
	overwrite(e) {
		return this.check(/* @__PURE__ */ za(e));
	},
	optional() {
		return fc(this);
	},
	exactOptional() {
		return mc(this);
	},
	nullable() {
		return gc(this);
	},
	nullish() {
		return fc(gc(this));
	},
	nonoptional(e) {
		return Sc(this, e);
	},
	array() {
		return F(this);
	},
	or(e) {
		return ec([this, e]);
	},
	and(e) {
		return ic(this, e);
	},
	transform(e) {
		return Ec(this, uc(e));
	},
	default(e) {
		return vc(this, e);
	},
	prefault(e) {
		return bc(this, e);
	},
	catch(e) {
		return wc(this, e);
	},
	pipe(e) {
		return Ec(this, e);
	},
	readonly() {
		return Oc(this);
	},
	describe(e) {
		let t = this.clone();
		return Gi.add(t, { description: e }), t;
	},
	meta(...e) {
		if (e.length === 0) return Gi.get(this);
		let t = this.clone();
		return Gi.add(t, e[0]), t;
	},
	isOptional() {
		return this.safeParse(void 0).success;
	},
	isNullable() {
		return this.safeParse(null).success;
	},
	apply(e, ...t) {
		return t.length === 0 ? e(this) : e(this, ...t);
	},
	get "~standard"() {
		return tt(this, "~standard", {
			...Jn(this),
			jsonSchema: {
				input: lo(this, "input"),
				output: lo(this, "output")
			}
		});
	},
	set "~standard"(e) {
		et(this, "~standard", e);
	},
	parse: function e(t, n) {
		return ts(this, t, n, { callee: e });
	},
	parseAsync: async function e(t, n) {
		return await ns(this, t, n, { callee: e });
	},
	safeParse(e, t) {
		return rs(this, e, t);
	},
	async safeParseAsync(e, t) {
		return is(this, e, t);
	},
	get spa() {
		return this?.safeParseAsync;
	},
	set spa(e) {
		et(this, "spa", e);
	},
	validate(e, t) {
		return It(this, e, t);
	},
	validateAsync(e, t) {
		return Rt(this, e, t);
	},
	encode: function e(t, n) {
		return as(this, t, n, { callee: e });
	},
	decode: function e(t, n) {
		return os(this, t, n, { callee: e });
	},
	encodeAsync: async function e(t, n) {
		return await ss(this, t, n, { callee: e });
	},
	decodeAsync: async function e(t, n) {
		return await cs(this, t, n, { callee: e });
	},
	safeEncode(e, t) {
		return ls(this, e, t);
	},
	safeDecode(e, t) {
		return us(this, e, t);
	},
	async safeEncodeAsync(e, t) {
		return ds(this, e, t);
	},
	async safeDecodeAsync(e, t) {
		return fs(this, e, t);
	},
	toJSONSchema(e) {
		return co(this, {})(e);
	},
	get description() {
		return Gi.get(this)?.description;
	},
	get _def() {
		return this._zod.def;
	}
}), hs = /*@__PURE__*/ T("_ZodString", (e, t) => {
	Yn.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Eo(e, t, n, r);
}, /*@__PURE__*/ nt({
	format: (e) => So(e).format ?? null,
	minLength: (e) => So(e).minimum ?? null,
	maxLength: (e) => So(e).maximum ?? null
}, {
	regex(...e) {
		return this.check(/* @__PURE__ */ Na(...e));
	},
	includes(...e) {
		return this.check(/* @__PURE__ */ Ia(...e));
	},
	startsWith(...e) {
		return this.check(/* @__PURE__ */ La(...e));
	},
	endsWith(...e) {
		return this.check(/* @__PURE__ */ Ra(...e));
	},
	min(...e) {
		return this.check(/* @__PURE__ */ ja(...e));
	},
	max(...e) {
		return this.check(/* @__PURE__ */ Aa(...e));
	},
	length(...e) {
		return this.check(/* @__PURE__ */ Ma(...e));
	},
	nonempty(...e) {
		return this.check(/* @__PURE__ */ ja(1, ...e));
	},
	lowercase(e) {
		return this.check(/* @__PURE__ */ Pa(e));
	},
	uppercase(e) {
		return this.check(/* @__PURE__ */ Fa(e));
	},
	trim() {
		return this.check(/* @__PURE__ */ Va());
	},
	normalize(...e) {
		return this.check(/* @__PURE__ */ Ba(...e));
	},
	toLowerCase() {
		return this.check(/* @__PURE__ */ Ha());
	},
	toUpperCase() {
		return this.check(/* @__PURE__ */ Ua());
	},
	slugify() {
		return this.check(/* @__PURE__ */ Wa());
	}
})), gs = /*@__PURE__*/ T("ZodString", (e, t) => {
	Yn.init(e, t), hs.init(e, t);
}, {
	email(e) {
		return this.check(/* @__PURE__ */ Ji(xs, e));
	},
	url(e) {
		return this.check(/* @__PURE__ */ ea(Ts, e));
	},
	jwt(e) {
		return this.check(/* @__PURE__ */ ha(Bs, e));
	},
	emoji(e) {
		return this.check(/* @__PURE__ */ ta(Es, e));
	},
	guid(e) {
		return this.check(/* @__PURE__ */ Yi(Ss, e));
	},
	uuid(e) {
		return this.check(/* @__PURE__ */ Xi(Cs, e));
	},
	uuidv4(e) {
		return this.check(/* @__PURE__ */ Zi(Cs, e));
	},
	uuidv6(e) {
		return this.check(/* @__PURE__ */ Qi(Cs, e));
	},
	uuidv7(e) {
		return this.check(/* @__PURE__ */ $i(Cs, e));
	},
	nanoid(e) {
		return this.check(/* @__PURE__ */ na(Ds, e));
	},
	cuid(e) {
		return this.check(/* @__PURE__ */ ra(Os, e));
	},
	cuid2(e) {
		return this.check(/* @__PURE__ */ ia(ks, e));
	},
	ulid(e) {
		return this.check(/* @__PURE__ */ aa(As, e));
	},
	base64(e) {
		return this.check(/* @__PURE__ */ fa(Ls, e));
	},
	base64url(e) {
		return this.check(/* @__PURE__ */ pa(Rs, e));
	},
	xid(e) {
		return this.check(/* @__PURE__ */ oa(js, e));
	},
	ksuid(e) {
		return this.check(/* @__PURE__ */ sa(Ms, e));
	},
	ipv4(e) {
		return this.check(/* @__PURE__ */ ca(Ns, e));
	},
	ipv6(e) {
		return this.check(/* @__PURE__ */ la(Ps, e));
	},
	cidrv4(e) {
		return this.check(/* @__PURE__ */ ua(Fs, e));
	},
	cidrv6(e) {
		return this.check(/* @__PURE__ */ da(Is, e));
	},
	e164(e) {
		return this.check(/* @__PURE__ */ ma(zs, e));
	},
	datetime(e) {
		return this.check(/* @__PURE__ */ ga(_s, e));
	},
	date(e) {
		return this.check(/* @__PURE__ */ _a(vs, e));
	},
	time(e) {
		return this.check(/* @__PURE__ */ va(ys, e));
	},
	duration(e) {
		return this.check(/* @__PURE__ */ ya(bs, e));
	}
});
function N(e) {
	return /* @__PURE__ */ qi(gs, e);
}
var P = /*@__PURE__*/ T("ZodStringFormat", (e, t) => {
	O.init(e, t), hs.init(e, t);
}), _s = /*@__PURE__*/ T("ZodISODateTime", (e, t) => {
	mr.init(e, t), P.init(e, t);
}), vs = /*@__PURE__*/ T("ZodISODate", (e, t) => {
	hr.init(e, t), P.init(e, t);
}), ys = /*@__PURE__*/ T("ZodISOTime", (e, t) => {
	gr.init(e, t), P.init(e, t);
}), bs = /*@__PURE__*/ T("ZodISODuration", (e, t) => {
	_r.init(e, t), P.init(e, t);
}), xs = /*@__PURE__*/ T("ZodEmail", (e, t) => {
	Qn.init(e, t), P.init(e, t);
}), Ss = /*@__PURE__*/ T("ZodGUID", (e, t) => {
	Xn.init(e, t), P.init(e, t);
}), Cs = /*@__PURE__*/ T("ZodUUID", (e, t) => {
	Zn.init(e, t), P.init(e, t);
});
function ws(e) {
	return /* @__PURE__ */ Xi(Cs, e);
}
var Ts = /*@__PURE__*/ T("ZodURL", (e, t) => {
	or.init(e, t), P.init(e, t);
}), Es = /*@__PURE__*/ T("ZodEmoji", (e, t) => {
	sr.init(e, t), P.init(e, t);
}), Ds = /*@__PURE__*/ T("ZodNanoID", (e, t) => {
	cr.init(e, t), P.init(e, t);
}), Os = /*@__PURE__*/ T("ZodCUID", (e, t) => {
	lr.init(e, t), P.init(e, t);
}), ks = /*@__PURE__*/ T("ZodCUID2", (e, t) => {
	ur.init(e, t), P.init(e, t);
}), As = /*@__PURE__*/ T("ZodULID", (e, t) => {
	dr.init(e, t), P.init(e, t);
}), js = /*@__PURE__*/ T("ZodXID", (e, t) => {
	fr.init(e, t), P.init(e, t);
}), Ms = /*@__PURE__*/ T("ZodKSUID", (e, t) => {
	pr.init(e, t), P.init(e, t);
}), Ns = /*@__PURE__*/ T("ZodIPv4", (e, t) => {
	vr.init(e, t), P.init(e, t);
}), Ps = /*@__PURE__*/ T("ZodIPv6", (e, t) => {
	xr.init(e, t), P.init(e, t);
}), Fs = /*@__PURE__*/ T("ZodCIDRv4", (e, t) => {
	Sr.init(e, t), P.init(e, t);
}), Is = /*@__PURE__*/ T("ZodCIDRv6", (e, t) => {
	wr.init(e, t), P.init(e, t);
}), Ls = /*@__PURE__*/ T("ZodBase64", (e, t) => {
	Dr.init(e, t), P.init(e, t);
}), Rs = /*@__PURE__*/ T("ZodBase64URL", (e, t) => {
	Ar.init(e, t), P.init(e, t);
}), zs = /*@__PURE__*/ T("ZodE164", (e, t) => {
	jr.init(e, t), P.init(e, t);
}), Bs = /*@__PURE__*/ T("ZodJWT", (e, t) => {
	Nr.init(e, t), P.init(e, t);
}), Vs = /*@__PURE__*/ T("ZodNumber", (e, t) => {
	Pr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Do(e, t, n, r), e.isFinite = !0;
}, /*@__PURE__*/ nt({
	minValue: (e) => {
		let { minimum: t, exclusiveMinimum: n } = So(e);
		return Math.max(t ?? -Infinity, n ?? -Infinity);
	},
	maxValue: (e) => {
		let { maximum: t, exclusiveMaximum: n } = So(e);
		return Math.min(t ?? Infinity, n ?? Infinity);
	},
	isInt: (e) => {
		let { isInt: t, multipleOf: n } = So(e);
		return !!t || !!n?.some(Number.isSafeInteger);
	},
	format: (e) => So(e).format ?? null
}, {
	gt(e, t) {
		return this.check(/* @__PURE__ */ Da(e, t));
	},
	gte(e, t) {
		return this.check(/* @__PURE__ */ Oa(e, t));
	},
	min(e, t) {
		return this.check(/* @__PURE__ */ Oa(e, t));
	},
	lt(e, t) {
		return this.check(/* @__PURE__ */ Ta(e, t));
	},
	lte(e, t) {
		return this.check(/* @__PURE__ */ Ea(e, t));
	},
	max(e, t) {
		return this.check(/* @__PURE__ */ Ea(e, t));
	},
	int(e) {
		return this.check(Ws(e));
	},
	safe(e) {
		return this.check(Ws(e));
	},
	positive(e) {
		return this.check(/* @__PURE__ */ Da(0, e));
	},
	nonnegative(e) {
		return this.check(/* @__PURE__ */ Oa(0, e));
	},
	negative(e) {
		return this.check(/* @__PURE__ */ Ta(0, e));
	},
	nonpositive(e) {
		return this.check(/* @__PURE__ */ Ea(0, e));
	},
	multipleOf(e, t) {
		return this.check(/* @__PURE__ */ ka(e, t));
	},
	step(e, t) {
		return this.check(/* @__PURE__ */ ka(e, t));
	},
	finite() {
		return this;
	}
}));
function Hs(e) {
	return /* @__PURE__ */ ba(Vs, e);
}
var Us = /*@__PURE__*/ T("ZodNumberFormat", (e, t) => {
	Fr.init(e, t), Vs.init(e, t);
});
function Ws(e) {
	return /* @__PURE__ */ xa(Us, e);
}
var Gs = /*@__PURE__*/ T("ZodBoolean", (e, t) => {
	Ir.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Oo(e, t, n, r);
});
function Ks(e) {
	return /* @__PURE__ */ Sa(Gs, e);
}
var qs = /*@__PURE__*/ T("ZodUnknown", (e, t) => {
	Lr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (e, t, n) => void 0;
});
function Js() {
	return /* @__PURE__ */ Ca(qs);
}
var Ys = /*@__PURE__*/ T("ZodNever", (e, t) => {
	Rr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => ko(e, t, n, r);
});
function Xs(e) {
	return /* @__PURE__ */ wa(Ys, e);
}
var Zs = /*@__PURE__*/ T("ZodArray", (e, t) => {
	ms(), Hr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Po(e, t, n, r), e.element = t.element;
}, {
	min(e, t) {
		return this.check(/* @__PURE__ */ ja(e, t));
	},
	nonempty(e) {
		return this.check(/* @__PURE__ */ ja(1, e));
	},
	max(e, t) {
		return this.check(/* @__PURE__ */ Aa(e, t));
	},
	length(e, t) {
		return this.check(/* @__PURE__ */ Ma(e, t));
	},
	unwrap() {
		return this.element;
	}
});
function F(e, t) {
	return /* @__PURE__ */ Ga(Zs, e, t);
}
var Qs = /*@__PURE__*/ T("ZodObject", (e, t) => {
	ms(), Jr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Io(e, t, n, r), ct(e, "shape", (e) => e._zod.def.shape, !1);
}, {
	keyof() {
		return L(Object.keys(this._zod.def.shape));
	},
	catchall(e) {
		return this.clone(S(this._zod.def, { catchall: e }));
	},
	passthrough() {
		return this.clone(S(this._zod.def, { catchall: Js() }));
	},
	loose() {
		return this.clone(S(this._zod.def, { catchall: Js() }));
	},
	strict() {
		return this.clone(S(this._zod.def, { catchall: Xs() }));
	},
	strip() {
		return this.clone(S(this._zod.def, { catchall: void 0 }));
	},
	extend(e) {
		return Fe(this, e);
	},
	safeExtend(e) {
		return Le(this, e);
	},
	merge(e) {
		return Re(this, e);
	},
	pick(e) {
		return Me(this, e);
	},
	omit(e) {
		return Pe(this, e);
	},
	partial(...e) {
		return ze(dc, this, e[0]);
	},
	exactPartial(...e) {
		return ze(pc, this, e[0], "exactPartial");
	},
	required(...e) {
		return Be(xc, this, e[0]);
	}
});
function I(e, t) {
	return new Qs({
		type: "object",
		shape: e,
		catchall: Xs(),
		...C(t)
	});
}
var $s = /*@__PURE__*/ T("ZodUnion", (e, t) => {
	Xr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Lo(e, t, n, r), e.options = t.options;
});
function ec(e, t) {
	return new $s({
		type: "union",
		options: e,
		...C(t)
	});
}
var tc = /*@__PURE__*/ T("ZodDiscriminatedUnion", (e, t) => {
	$s.init(e, t), Qr.init(e, t);
});
function nc(e, t, n) {
	return new tc({
		type: "union",
		options: t,
		discriminator: e,
		...C(n)
	});
}
var rc = /*@__PURE__*/ T("ZodIntersection", (e, t) => {
	$r.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ro(e, t, n, r);
});
function ic(e, t) {
	return new rc({
		type: "intersection",
		left: e,
		right: t
	});
}
var ac = /*@__PURE__*/ T("ZodRecord", (e, t) => {
	ms(), ni.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ho(e, t, n, r), e.keyType = t.keyType, e.valueType = t.valueType;
});
function oc(e, t, n) {
	return !t || !t._zod ? new ac({
		type: "record",
		keyType: N(),
		valueType: e,
		...C(t)
	}) : new ac({
		type: "record",
		keyType: e,
		valueType: t,
		...C(n)
	});
}
var sc = /*@__PURE__*/ T("ZodEnum", (e, t) => {
	ri.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ao(e, t, n, r), e.enum = t.entries, e.options = [...e._zod.values];
	let n = new Set(Object.keys(t.entries));
	e.extract = (e, r) => {
		let i = {};
		for (let r of e) if (n.has(r)) i[r] = t.entries[r];
		else throw Error(`Key ${r} not found in enum`);
		return new sc({
			...t,
			checks: [],
			...C(r),
			entries: i
		});
	}, e.exclude = (e, r) => {
		let i = { ...t.entries };
		for (let t of e) if (n.has(t)) delete i[t];
		else throw Error(`Key ${t} not found in enum`);
		return new sc({
			...t,
			checks: [],
			...C(r),
			entries: i
		});
	};
});
function L(e, t) {
	return new sc({
		type: "enum",
		entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
		...C(t)
	});
}
var cc = /*@__PURE__*/ T("ZodLiteral", (e, t) => {
	ii.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => jo(e, t, n, r), e.values = new Set(t.values), Object.defineProperty(e, "value", { get() {
		if (t.values.length > 1) throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return t.values[0];
	} });
});
function R(e, t) {
	return new cc({
		type: "literal",
		values: Array.isArray(e) ? e : [e],
		...C(t)
	});
}
var lc = /*@__PURE__*/ T("ZodTransform", (e, t) => {
	ms(), ai.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => No(e, t, n, r), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new gt(e.constructor.name);
		n.addIssue = (r) => {
			if (typeof r == "string") n.issues.push(Qe(r, n.value, t));
			else {
				let t = r;
				t.fatal && (t.continue = !1), t.code ??= "custom", "input" in t || (t.input = n.value), t.inst ??= e, n.issues.push(Qe(t));
			}
		};
		let i = t.transform(n.value, n);
		return i instanceof Promise ? i.then((e) => (n.value = e, n)) : (n.value = i, n);
	};
});
function uc(e) {
	return new lc({
		type: "transform",
		transform: e
	});
}
var dc = /*@__PURE__*/ T("ZodOptional", (e, t) => {
	si.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Qo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function fc(e) {
	return new dc({
		type: "optional",
		innerType: e
	});
}
var pc = /*@__PURE__*/ T("ZodExactOptional", (e, t) => {
	ci.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Qo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function mc(e) {
	return new pc({
		type: "optional",
		innerType: e
	});
}
var hc = /*@__PURE__*/ T("ZodNullable", (e, t) => {
	li.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Uo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function gc(e) {
	return new hc({
		type: "nullable",
		innerType: e
	});
}
var _c = /*@__PURE__*/ T("ZodDefault", (e, t) => {
	ui.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => qo(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function vc(e, t) {
	return new _c({
		type: "default",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : we(t);
		}
	});
}
var yc = /*@__PURE__*/ T("ZodPrefault", (e, t) => {
	fi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Jo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function bc(e, t) {
	return new yc({
		type: "prefault",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : we(t);
		}
	});
}
var xc = /*@__PURE__*/ T("ZodNonOptional", (e, t) => {
	pi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Wo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Sc(e, t) {
	return new xc({
		type: "nonoptional",
		innerType: e,
		...C(t)
	});
}
var Cc = /*@__PURE__*/ T("ZodCatch", (e, t) => {
	gi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Yo(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function wc(e, t) {
	return new Cc({
		type: "catch",
		innerType: e,
		catchValue: typeof t == "function" ? t : ut(t)
	});
}
var Tc = /*@__PURE__*/ T("ZodPipe", (e, t) => {
	_i.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Xo(e, t, n, r), e.in = t.in, e.out = t.out;
});
function Ec(e, t) {
	return new Tc({
		type: "pipe",
		in: e,
		out: t
	});
}
var Dc = /*@__PURE__*/ T("ZodReadonly", (e, t) => {
	yi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Zo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Oc(e) {
	return new Dc({
		type: "readonly",
		innerType: e
	});
}
var kc = /*@__PURE__*/ T("ZodCustom", (e, t) => {
	xi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Mo(e, t, n, r);
});
function Ac(e, t) {
	return /* @__PURE__ */ Ka(kc, e ?? (() => !0), t);
}
function jc(e, t = {}) {
	return /* @__PURE__ */ qa(kc, e, t);
}
function Mc(e, t) {
	return /* @__PURE__ */ Ja(e, t);
}
// node_modules/zod/v4/classic/iso.js
function Nc(e) {
	return /* @__PURE__ */ ga(_s, e);
}
// node_modules/yaml/browser/dist/nodes/identity.js
var Pc = Symbol.for("yaml.alias"), Fc = Symbol.for("yaml.document"), Ic = Symbol.for("yaml.map"), Lc = Symbol.for("yaml.pair"), Rc = Symbol.for("yaml.scalar"), zc = Symbol.for("yaml.seq"), Bc = Symbol.for("yaml.node.type"), Vc = (e) => !!e && typeof e == "object" && e[Bc] === Pc, Hc = (e) => !!e && typeof e == "object" && e[Bc] === Fc, Uc = (e) => !!e && typeof e == "object" && e[Bc] === Ic, z = (e) => !!e && typeof e == "object" && e[Bc] === Lc, B = (e) => !!e && typeof e == "object" && e[Bc] === Rc, Wc = (e) => !!e && typeof e == "object" && e[Bc] === zc;
function V(e) {
	if (e && typeof e == "object") switch (e[Bc]) {
		case Ic:
		case zc: return !0;
	}
	return !1;
}
function H(e) {
	if (e && typeof e == "object") switch (e[Bc]) {
		case Pc:
		case Ic:
		case Rc:
		case zc: return !0;
	}
	return !1;
}
var Gc = (e) => (B(e) || V(e)) && !!e.anchor, Kc = Symbol("break visit"), qc = Symbol("skip children"), Jc = Symbol("remove node");
function Yc(e, t) {
	let n = Zc(t);
	Hc(e) ? Xc(null, e.contents, n, Object.freeze([e])) === Jc && (e.contents = null) : Xc(null, e, n, Object.freeze([]));
}
Yc.BREAK = Kc, Yc.SKIP = qc, Yc.REMOVE = Jc;
function Xc(e, t, n, r) {
	let i = Qc(e, t, n, r);
	if (H(i) || z(i)) return $c(e, r, i), Xc(e, i, n, r);
	if (typeof i != "symbol") {
		if (V(t)) {
			r = Object.freeze(r.concat(t));
			for (let e = 0; e < t.items.length; ++e) {
				let i = Xc(e, t.items[e], n, r);
				if (typeof i == "number") e = i - 1;
				else if (i === Kc) return Kc;
				else i === Jc && (t.items.splice(e, 1), --e);
			}
		} else if (z(t)) {
			r = Object.freeze(r.concat(t));
			let e = Xc("key", t.key, n, r);
			if (e === Kc) return Kc;
			e === Jc && (t.key = null);
			let i = Xc("value", t.value, n, r);
			if (i === Kc) return Kc;
			i === Jc && (t.value = null);
		}
	}
	return i;
}
function Zc(e) {
	return typeof e == "object" && (e.Collection || e.Node || e.Value) ? Object.assign({
		Alias: e.Node,
		Map: e.Node,
		Scalar: e.Node,
		Seq: e.Node
	}, e.Value && {
		Map: e.Value,
		Scalar: e.Value,
		Seq: e.Value
	}, e.Collection && {
		Map: e.Collection,
		Seq: e.Collection
	}, e) : e;
}
function Qc(e, t, n, r) {
	if (typeof n == "function") return n(e, t, r);
	if (Uc(t)) return n.Map?.(e, t, r);
	if (Wc(t)) return n.Seq?.(e, t, r);
	if (z(t)) return n.Pair?.(e, t, r);
	if (B(t)) return n.Scalar?.(e, t, r);
	if (Vc(t)) return n.Alias?.(e, t, r);
}
function $c(e, t, n) {
	let r = t[t.length - 1];
	if (V(r)) r.items[e] = n;
	else if (z(r)) e === "key" ? r.key = n : r.value = n;
	else if (Hc(r)) r.contents = n;
	else {
		let e = Vc(r) ? "alias" : "scalar";
		throw Error(`Cannot replace node with ${e} parent`);
	}
}
// node_modules/yaml/browser/dist/doc/directives.js
var el = {
	"!": "%21",
	",": "%2C",
	"[": "%5B",
	"]": "%5D",
	"{": "%7B",
	"}": "%7D"
}, tl = (e) => e.replace(/[!,[\]{}]/g, (e) => el[e]), nl = class e {
	constructor(t, n) {
		this.docStart = null, this.docEnd = !1, this.yaml = Object.assign({}, e.defaultYaml, t), this.tags = Object.assign({}, e.defaultTags, n);
	}
	clone() {
		let t = new e(this.yaml, this.tags);
		return t.docStart = this.docStart, t;
	}
	atDocument() {
		let t = new e(this.yaml, this.tags);
		switch (this.yaml.version) {
			case "1.1":
				this.atNextDocument = !0;
				break;
			case "1.2": this.atNextDocument = !1, this.yaml = {
				explicit: e.defaultYaml.explicit,
				version: "1.2"
			}, this.tags = Object.assign({}, e.defaultTags);
		}
		return t;
	}
	add(t, n) {
		this.atNextDocument &&= (this.yaml = {
			explicit: e.defaultYaml.explicit,
			version: "1.1"
		}, this.tags = Object.assign({}, e.defaultTags), !1);
		let r = t.trim().split(/[ \t]+/), i = r.shift();
		switch (i) {
			case "%TAG": {
				if (r.length !== 2 && (n(0, "%TAG directive should contain exactly two parts"), r.length < 2)) return !1;
				let [e, t] = r;
				return this.tags[e] = t, !0;
			}
			case "%YAML": {
				if (this.yaml.explicit = !0, r.length !== 1) return n(0, "%YAML directive should contain exactly one part"), !1;
				let [e] = r;
				if (e === "1.1" || e === "1.2") return this.yaml.version = e, !0;
				{
					let t = /^\d+\.\d+$/.test(e);
					return n(6, `Unsupported YAML version ${e}`, t), !1;
				}
			}
			default: return n(0, `Unknown directive ${i}`, !0), !1;
		}
	}
	tagName(e, t) {
		if (e === "!") return "!";
		if (e[0] !== "!") return t(`Not a valid tag: ${e}`), null;
		if (e[1] === "<") {
			let n = e.slice(2, -1);
			return n === "!" || n === "!!" ? (t(`Verbatim tags aren't resolved, so ${e} is invalid.`), null) : (e[e.length - 1] !== ">" && t("Verbatim tags must end with a >"), n);
		}
		let [, n, r] = e.match(/^(.*!)([^!]*)$/s);
		r || t(`The ${e} tag has no suffix`);
		let i = this.tags[n];
		if (i) try {
			return i + decodeURIComponent(r);
		} catch (e) {
			return t(String(e)), null;
		}
		return n === "!" ? e : (t(`Could not resolve tag: ${e}`), null);
	}
	tagString(e) {
		for (let [t, n] of Object.entries(this.tags)) if (e.startsWith(n)) return t + tl(e.substring(n.length));
		return e[0] === "!" ? e : `!<${e}>`;
	}
	toString(e) {
		let t = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [], n = Object.entries(this.tags), r;
		if (e && n.length > 0 && H(e.contents)) {
			let t = {};
			Yc(e.contents, (e, n) => {
				H(n) && n.tag && (t[n.tag] = !0);
			}), r = Object.keys(t);
		} else r = [];
		for (let [i, a] of n) i === "!!" && a === "tag:yaml.org,2002:" || e && !r.some((e) => e.startsWith(a)) || t.push(`%TAG ${i} ${a}`);
		return t.join("\n");
	}
};
nl.defaultYaml = {
	explicit: !1,
	version: "1.2"
}, nl.defaultTags = { "!!": "tag:yaml.org,2002:" };
// node_modules/yaml/browser/dist/doc/anchors.js
function rl(e) {
	if (/[\x00-\x19\s,[\]{}]/.test(e)) {
		let t = `Anchor must not contain whitespace or control characters: ${JSON.stringify(e)}`;
		throw Error(t);
	}
	return !0;
}
function il(e) {
	let t = /* @__PURE__ */ new Set();
	return Yc(e, { Value(e, n) {
		n.anchor && t.add(n.anchor);
	} }), t;
}
function al(e, t) {
	for (let n = 1;; ++n) {
		let r = `${e}${n}`;
		if (!t.has(r)) return r;
	}
}
function ol(e, t) {
	let n = [], r = /* @__PURE__ */ new Map(), i = null;
	return {
		onAnchor: (r) => {
			n.push(r), i ??= il(e);
			let a = al(t, i);
			return i.add(a), a;
		},
		setAnchors: () => {
			for (let e of n) {
				let t = r.get(e);
				if (typeof t == "object" && t.anchor && (B(t.node) || V(t.node))) t.node.anchor = t.anchor;
				else {
					let t = /* @__PURE__ */ Error("Failed to resolve repeated object (this should not happen)");
					throw t.source = e, t;
				}
			}
		},
		sourceObjects: r
	};
}
// node_modules/yaml/browser/dist/doc/applyReviver.js
function sl(e, t, n, r) {
	if (r && typeof r == "object") {
		if (Array.isArray(r)) for (let t = 0, n = r.length; t < n; ++t) {
			let n = r[t], i = sl(e, r, String(t), n);
			i === void 0 ? delete r[t] : i !== n && (r[t] = i);
		}
		else if (r instanceof Map) for (let t of Array.from(r.keys())) {
			let n = r.get(t), i = sl(e, r, t, n);
			i === void 0 ? r.delete(t) : i !== n && r.set(t, i);
		}
		else if (r instanceof Set) for (let t of Array.from(r)) {
			let n = sl(e, r, t, t);
			n === void 0 ? r.delete(t) : n !== t && (r.delete(t), r.add(n));
		}
		else for (let [t, n] of Object.entries(r)) {
			let i = sl(e, r, t, n);
			i === void 0 ? delete r[t] : i !== n && (r[t] = i);
		}
	}
	return e.call(t, n, r);
}
// node_modules/yaml/browser/dist/nodes/toJS.js
function U(e, t, n) {
	if (Array.isArray(e)) return e.map((e, t) => U(e, String(t), n));
	if (e && typeof e.toJSON == "function") {
		if (!n || !Gc(e)) return e.toJSON(t, n);
		let r = {
			aliasCount: 0,
			count: 1,
			res: void 0
		};
		n.anchors.set(e, r), n.onCreate = (e) => {
			r.res = e, delete n.onCreate;
		};
		let i = e.toJSON(t, n);
		return n.onCreate && n.onCreate(i), i;
	}
	return typeof e == "bigint" && !n?.keep ? Number(e) : e;
}
// node_modules/yaml/browser/dist/nodes/Node.js
var cl = class {
	constructor(e) {
		Object.defineProperty(this, Bc, { value: e });
	}
	clone() {
		let e = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
		return this.range && (e.range = this.range.slice()), e;
	}
	toJS(e, { mapAsMap: t, maxAliasCount: n, onAnchor: r, reviver: i } = {}) {
		if (!Hc(e)) throw TypeError("A document argument is required");
		let a = {
			anchors: /* @__PURE__ */ new Map(),
			doc: e,
			keep: !0,
			mapAsMap: t === !0,
			mapKeyWarned: !1,
			maxAliasCount: typeof n == "number" ? n : 100
		}, o = U(this, "", a);
		if (typeof r == "function") for (let { count: e, res: t } of a.anchors.values()) r(t, e);
		return typeof i == "function" ? sl(i, { "": o }, "", o) : o;
	}
}, ll = class extends cl {
	constructor(e) {
		super(Pc), this.source = e, Object.defineProperty(this, "tag", { set() {
			throw Error("Alias nodes cannot have tags");
		} });
	}
	resolve(e, t) {
		if (t?.maxAliasCount === 0) throw ReferenceError("Alias resolution is disabled");
		let n;
		t?.aliasResolveCache ? n = t.aliasResolveCache : (n = [], Yc(e, { Node: (e, t) => {
			(Vc(t) || Gc(t)) && n.push(t);
		} }), t && (t.aliasResolveCache = n));
		let r;
		for (let e of n) {
			if (e === this) break;
			e.anchor === this.source && (r = e);
		}
		if (r && t) {
			let { anchors: e, doc: n, maxAliasCount: i } = t, a = e.get(r);
			/* istanbul ignore if */
			if (a ||= (U(r, null, t), e.get(r)), a?.res === void 0) throw ReferenceError("This should not happen: Alias anchor was not resolved?");
			if (i >= 0 && (a.count += 1, a.aliasCount === 0 && (a.aliasCount = ul(n, r, e)), a.count * a.aliasCount > i)) throw ReferenceError("Excessive alias count indicates a resource exhaustion attack");
		}
		return r;
	}
	toJSON(e, t) {
		if (!t) return { source: this.source };
		let n = this.resolve(t.doc, t);
		if (!n) {
			let e = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
			throw ReferenceError(e);
		}
		return t.anchors.get(n).res;
	}
	toString(e, t, n) {
		let r = `*${this.source}`;
		if (e) {
			if (rl(this.source), e.options.verifyAliasOrder && !e.anchors.has(this.source)) {
				let e = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
				throw Error(e);
			}
			if (e.implicitKey) return `${r} `;
		}
		return r;
	}
};
function ul(e, t, n) {
	if (Vc(t)) {
		let r = t.resolve(e), i = n && r && n.get(r);
		return i ? i.count * i.aliasCount : 0;
	}
	if (V(t)) {
		let r = 0;
		for (let i of t.items) {
			let t = ul(e, i, n);
			t > r && (r = t);
		}
		return r;
	}
	if (z(t)) {
		let r = ul(e, t.key, n), i = ul(e, t.value, n);
		return Math.max(r, i);
	}
	return 1;
}
// node_modules/yaml/browser/dist/nodes/Scalar.js
var dl = (e) => !e || typeof e != "function" && typeof e != "object", W = class extends cl {
	constructor(e) {
		super(Rc), this.value = e;
	}
	toJSON(e, t) {
		return t?.keep ? this.value : U(this.value, e, t);
	}
	toString() {
		return String(this.value);
	}
};
W.BLOCK_FOLDED = "BLOCK_FOLDED", W.BLOCK_LITERAL = "BLOCK_LITERAL", W.PLAIN = "PLAIN", W.QUOTE_DOUBLE = "QUOTE_DOUBLE", W.QUOTE_SINGLE = "QUOTE_SINGLE";
// node_modules/yaml/browser/dist/doc/createNode.js
var fl = "tag:yaml.org,2002:";
function pl(e, t, n) {
	if (t) {
		let e = n.filter((e) => e.tag === t), r = e.find((e) => !e.format) ?? e[0];
		if (!r) throw Error(`Tag ${t} not found`);
		return r;
	}
	return n.find((t) => t.identify?.(e) && !t.format);
}
function ml(e, t, n) {
	if (Hc(e) && (e = e.contents), H(e)) return e;
	if (z(e)) {
		let t = n.schema[Ic].createNode?.(n.schema, null, n);
		return t.items.push(e), t;
	}
	(e instanceof String || e instanceof Number || e instanceof Boolean || typeof BigInt < "u" && e instanceof BigInt) && (e = e.valueOf());
	let { aliasDuplicateObjects: r, onAnchor: i, onTagObj: a, schema: o, sourceObjects: s } = n, c;
	if (r && e && typeof e == "object") {
		if (c = s.get(e), c) return c.anchor ?? (c.anchor = i(e)), new ll(c.anchor);
		c = {
			anchor: null,
			node: null
		}, s.set(e, c);
	}
	t?.startsWith("!!") && (t = fl + t.slice(2));
	let l = pl(e, t, o.tags);
	if (!l) {
		if (e && typeof e.toJSON == "function" && (e = e.toJSON()), !e || typeof e != "object") {
			let t = new W(e);
			return c && (c.node = t), t;
		}
		l = e instanceof Map ? o[Ic] : Symbol.iterator in Object(e) ? o[zc] : o[Ic];
	}
	a && (a(l), delete n.onTagObj);
	let u = l?.createNode ? l.createNode(n.schema, e, n) : typeof l?.nodeClass?.from == "function" ? l.nodeClass.from(n.schema, e, n) : new W(e);
	return t ? u.tag = t : l.default || (u.tag = l.tag), c && (c.node = u), u;
}
// node_modules/yaml/browser/dist/nodes/Collection.js
function hl(e, t, n) {
	let r = n;
	for (let e = t.length - 1; e >= 0; --e) {
		let n = t[e];
		if (typeof n == "number" && Number.isInteger(n) && n >= 0) {
			let e = [];
			e[n] = r, r = e;
		} else r = /* @__PURE__ */ new Map([[n, r]]);
	}
	return ml(r, void 0, {
		aliasDuplicateObjects: !1,
		keepUndefined: !1,
		onAnchor: () => {
			throw Error("This should not happen, please report a bug.");
		},
		schema: e,
		sourceObjects: /* @__PURE__ */ new Map()
	});
}
var gl = (e) => e == null || typeof e == "object" && !!e[Symbol.iterator]().next().done, _l = class extends cl {
	constructor(e, t) {
		super(e), Object.defineProperty(this, "schema", {
			value: t,
			configurable: !0,
			enumerable: !1,
			writable: !0
		});
	}
	clone(e) {
		let t = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
		return e && (t.schema = e), t.items = t.items.map((t) => H(t) || z(t) ? t.clone(e) : t), this.range && (t.range = this.range.slice()), t;
	}
	addIn(e, t) {
		if (gl(e)) this.add(t);
		else {
			let [n, ...r] = e, i = this.get(n, !0);
			if (V(i)) i.addIn(r, t);
			else if (i === void 0 && this.schema) this.set(n, hl(this.schema, r, t));
			else throw Error(`Expected YAML collection at ${n}. Remaining path: ${r}`);
		}
	}
	deleteIn(e) {
		let [t, ...n] = e;
		if (n.length === 0) return this.delete(t);
		let r = this.get(t, !0);
		if (V(r)) return r.deleteIn(n);
		throw Error(`Expected YAML collection at ${t}. Remaining path: ${n}`);
	}
	getIn(e, t) {
		let [n, ...r] = e, i = this.get(n, !0);
		return r.length === 0 ? !t && B(i) ? i.value : i : V(i) ? i.getIn(r, t) : void 0;
	}
	hasAllNullValues(e) {
		return this.items.every((t) => {
			if (!z(t)) return !1;
			let n = t.value;
			return n == null || e && B(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
		});
	}
	hasIn(e) {
		let [t, ...n] = e;
		if (n.length === 0) return this.has(t);
		let r = this.get(t, !0);
		return V(r) ? r.hasIn(n) : !1;
	}
	setIn(e, t) {
		let [n, ...r] = e;
		if (r.length === 0) this.set(n, t);
		else {
			let e = this.get(n, !0);
			if (V(e)) e.setIn(r, t);
			else if (e === void 0 && this.schema) this.set(n, hl(this.schema, r, t));
			else throw Error(`Expected YAML collection at ${n}. Remaining path: ${r}`);
		}
	}
}, vl = (e) => e.replace(/^(?!$)(?: $)?/gm, "#");
function yl(e, t) {
	return /^\n+$/.test(e) ? e.substring(1) : t ? e.replace(/^(?! *$)/gm, t) : e;
}
var bl = (e, t, n) => e.endsWith("\n") ? yl(n, t) : n.includes("\n") ? "\n" + yl(n, t) : (e.endsWith(" ") ? "" : " ") + n, xl = "flow", Sl = "block", Cl = "quoted";
function wl(e, t, n = "flow", { indentAtStart: r, lineWidth: i = 80, minContentWidth: a = 20, onFold: o, onOverflow: s } = {}) {
	if (!i || i < 0) return e;
	i < a && (a = 0);
	let c = Math.max(1 + a, 1 + i - t.length);
	if (e.length <= c) return e;
	let l = [], u = {}, d = i - t.length;
	typeof r == "number" && (r > i - Math.max(2, a) ? l.push(0) : d = i - r);
	let f, p, m = !1, h = -1, g = -1, _ = -1;
	n === "block" && (h = Tl(e, h, t.length), h !== -1 && (d = h + c));
	for (let r; r = e[h += 1];) {
		if (n === "quoted" && r === "\\") {
			switch (g = h, e[h + 1]) {
				case "x":
					h += 3;
					break;
				case "u":
					h += 5;
					break;
				case "U":
					h += 9;
					break;
				default: h += 1;
			}
			_ = h;
		}
		if (r === "\n") n === "block" && (h = Tl(e, h, t.length)), d = h + t.length + c, f = void 0;
		else {
			if (r === " " && p && p !== " " && p !== "\n" && p !== "	") {
				let t = e[h + 1];
				t && t !== " " && t !== "\n" && t !== "	" && (f = h);
			}
			if (h >= d) {
				if (f) l.push(f), d = f + c, f = void 0;
				else if (n === "quoted") {
					for (; p === " " || p === "	";) p = r, r = e[h += 1], m = !0;
					let t = h > _ + 1 ? h - 2 : g - 1;
					if (u[t]) return e;
					l.push(t), u[t] = !0, d = t + c, f = void 0;
				} else m = !0;
			}
		}
		p = r;
	}
	if (m && s && s(), l.length === 0) return e;
	o && o();
	let v = e.slice(0, l[0]);
	for (let r = 0; r < l.length; ++r) {
		let i = l[r], a = l[r + 1] || e.length;
		i === 0 ? v = `\n${t}${e.slice(0, a)}` : (n === "quoted" && u[i] && (v += `${e[i]}\\`), v += `\n${t}${e.slice(i + 1, a)}`);
	}
	return v;
}
function Tl(e, t, n) {
	let r = t, i = t + 1, a = e[i];
	for (; a === " " || a === "	";) if (t < i + n) a = e[++t];
	else {
		do
			a = e[++t];
		while (a && a !== "\n");
		r = t, i = t + 1, a = e[i];
	}
	return r;
}
// node_modules/yaml/browser/dist/stringify/stringifyString.js
var El = (e, t) => ({
	indentAtStart: t ? e.indent.length : e.indentAtStart,
	lineWidth: e.options.lineWidth,
	minContentWidth: e.options.minContentWidth
}), Dl = (e) => /^(%|---|\.\.\.)/m.test(e);
function Ol(e, t, n) {
	if (!t || t < 0) return !1;
	let r = t - n, i = e.length;
	if (i <= r) return !1;
	for (let t = 0, n = 0; t < i; ++t) if (e[t] === "\n") {
		if (t - n > r) return !0;
		if (n = t + 1, i - n <= r) return !1;
	}
	return !0;
}
function kl(e, t) {
	let n = JSON.stringify(e);
	if (t.options.doubleQuotedAsJSON) return n;
	let { implicitKey: r } = t, i = t.options.doubleQuotedMinMultiLineLength, a = t.indent || (Dl(e) ? "  " : ""), o = "", s = 0;
	for (let e = 0, t = n[e]; t; t = n[++e]) if (t === " " && n[e + 1] === "\\" && n[e + 2] === "n" && (o += n.slice(s, e) + "\\ ", e += 1, s = e, t = "\\"), t === "\\") switch (n[e + 1]) {
		case "u":
			{
				o += n.slice(s, e);
				let t = n.substr(e + 2, 4);
				switch (t) {
					case "0000":
						o += "\\0";
						break;
					case "0007":
						o += "\\a";
						break;
					case "000b":
						o += "\\v";
						break;
					case "001b":
						o += "\\e";
						break;
					case "0085":
						o += "\\N";
						break;
					case "00a0":
						o += "\\_";
						break;
					case "2028":
						o += "\\L";
						break;
					case "2029":
						o += "\\P";
						break;
					default: t.substr(0, 2) === "00" ? o += "\\x" + t.substr(2) : o += n.substr(e, 6);
				}
				e += 5, s = e + 1;
			}
			break;
		case "n":
			if (r || n[e + 2] === "\"" || n.length < i) e += 1;
			else {
				for (o += n.slice(s, e) + "\n\n"; n[e + 2] === "\\" && n[e + 3] === "n" && n[e + 4] !== "\"";) o += "\n", e += 2;
				o += a, n[e + 2] === " " && (o += "\\"), e += 1, s = e + 1;
			}
			break;
		default: e += 1;
	}
	return o = s ? o + n.slice(s) : n, r ? o : wl(o, a, Cl, El(t, !1));
}
function Al(e, t) {
	if (t.options.singleQuote === !1 || t.implicitKey && e.includes("\n") || /[ \t]\n|\n[ \t]/.test(e)) return kl(e, t);
	let n = t.indent || (Dl(e) ? "  " : ""), r = "'" + e.replace(/'/g, "''").replace(/\n+/g, `$&\n${n}`) + "'";
	return t.implicitKey ? r : wl(r, n, xl, El(t, !1));
}
function jl(e, t) {
	let { singleQuote: n } = t.options, r;
	if (n === !1) r = kl;
	else {
		let t = e.includes("\""), i = e.includes("'");
		r = t && !i ? Al : i && !t ? kl : n ? Al : kl;
	}
	return r(e, t);
}
var Ml;
try {
	Ml = /* @__PURE__ */ RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
} catch {
	Ml = /\n+(?!\n|$)/g;
}
function Nl({ comment: e, type: t, value: n }, r, i, a) {
	let { blockQuote: o, commentString: s, lineWidth: c } = r.options;
	if (!o || /\n[\t ]+$/.test(n)) return jl(n, r);
	let l = r.indent || (r.forceBlockIndent || Dl(n) ? "  " : ""), u = o === "literal" ? !0 : o === "folded" || t === W.BLOCK_FOLDED ? !1 : t === W.BLOCK_LITERAL || !Ol(n, c, l.length);
	if (!n) return u ? "|\n" : ">\n";
	let d, f;
	for (f = n.length; f > 0; --f) {
		let e = n[f - 1];
		if (e !== "\n" && e !== "	" && e !== " ") break;
	}
	let p = n.substring(f), m = p.indexOf("\n");
	m === -1 ? d = "-" : n === p || m !== p.length - 1 ? (d = "+", a && a()) : d = "", p &&= (n = n.slice(0, -p.length), p[p.length - 1] === "\n" && (p = p.slice(0, -1)), p.replace(Ml, `$&${l}`));
	let h = !1, g, _ = -1;
	for (g = 0; g < n.length; ++g) {
		let e = n[g];
		if (e === " ") h = !0;
		else if (e === "\n") _ = g;
		else break;
	}
	let v = n.substring(0, _ < g ? _ + 1 : g);
	v &&= (n = n.substring(v.length), v.replace(/\n+/g, `$&${l}`));
	let y = (h ? l ? "2" : "1" : "") + d;
	if (e && (y += " " + s(e.replace(/ ?[\r\n]+/g, " ")), i && i()), !u) {
		let e = n.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${l}`), i = !1, a = El(r, !0);
		o !== "folded" && t !== W.BLOCK_FOLDED && (a.onOverflow = () => {
			i = !0;
		});
		let s = wl(`${v}${e}${p}`, l, Sl, a);
		if (!i) return `>${y}\n${l}${s}`;
	}
	return n = n.replace(/\n+/g, `$&${l}`), `|${y}\n${l}${v}${n}${p}`;
}
function Pl(e, t, n, r) {
	let { type: i, value: a } = e, { actualString: o, implicitKey: s, indent: c, indentStep: l, inFlow: u } = t;
	if (s && a.includes("\n") || u && /[[\]{},]/.test(a)) return jl(a, t);
	if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(a)) return s || u || !a.includes("\n") ? jl(a, t) : Nl(e, t, n, r);
	if (!s && !u && i !== W.PLAIN && a.includes("\n")) return Nl(e, t, n, r);
	if (Dl(a)) {
		if (c === "") return t.forceBlockIndent = !0, Nl(e, t, n, r);
		if (s && c === l) return jl(a, t);
	}
	let d = a.replace(/\n+/g, `$&\n${c}`);
	if (o) {
		let e = (e) => e.default && e.tag !== "tag:yaml.org,2002:str" && e.test?.test(d), { compat: n, tags: r } = t.doc.schema;
		if (r.some(e) || n?.some(e)) return jl(a, t);
	}
	return s ? d : wl(d, c, xl, El(t, !1));
}
function Fl(e, t, n, r) {
	let { implicitKey: i, inFlow: a } = t, o = typeof e.value == "string" ? e : Object.assign({}, e, { value: String(e.value) }), { type: s } = e;
	s !== W.QUOTE_DOUBLE && /[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(o.value) && (s = W.QUOTE_DOUBLE);
	let c = (e) => {
		switch (e) {
			case W.BLOCK_FOLDED:
			case W.BLOCK_LITERAL: return i || a ? jl(o.value, t) : Nl(o, t, n, r);
			case W.QUOTE_DOUBLE: return kl(o.value, t);
			case W.QUOTE_SINGLE: return Al(o.value, t);
			case W.PLAIN: return Pl(o, t, n, r);
			default: return null;
		}
	}, l = c(s);
	if (l === null) {
		let { defaultKeyType: e, defaultStringType: n } = t.options, r = i && e || n;
		if (l = c(r), l === null) throw Error(`Unsupported default string type ${r}`);
	}
	return l;
}
// node_modules/yaml/browser/dist/stringify/stringify.js
function Il(e, t) {
	let n = Object.assign({
		blockQuote: !0,
		commentString: vl,
		defaultKeyType: null,
		defaultStringType: "PLAIN",
		directives: null,
		doubleQuotedAsJSON: !1,
		doubleQuotedMinMultiLineLength: 40,
		falseStr: "false",
		flowCollectionPadding: !0,
		indentSeq: !0,
		lineWidth: 80,
		minContentWidth: 20,
		nullStr: "null",
		simpleKeys: !1,
		singleQuote: null,
		trailingComma: !1,
		trueStr: "true",
		verifyAliasOrder: !0
	}, e.schema.toStringOptions, t), r;
	switch (n.collectionStyle) {
		case "block":
			r = !1;
			break;
		case "flow":
			r = !0;
			break;
		default: r = null;
	}
	return {
		anchors: /* @__PURE__ */ new Set(),
		doc: e,
		flowCollectionPadding: n.flowCollectionPadding ? " " : "",
		indent: "",
		indentStep: typeof n.indent == "number" ? " ".repeat(n.indent) : "  ",
		inFlow: r,
		options: n
	};
}
function Ll(e, t) {
	if (t.tag) {
		let n = e.filter((e) => e.tag === t.tag);
		if (n.length > 0) return n.find((e) => e.format === t.format) ?? n[0];
	}
	let n, r;
	if (B(t)) {
		r = t.value;
		let i = e.filter((e) => e.identify?.(r));
		if (i.length > 1) {
			let e = i.filter((e) => e.test);
			e.length > 0 && (i = e);
		}
		n = i.find((e) => e.format === t.format) ?? i.find((e) => !e.format);
	} else r = t, n = e.find((e) => e.nodeClass && r instanceof e.nodeClass);
	if (!n) {
		let e = r?.constructor?.name ?? (r === null ? "null" : typeof r);
		throw Error(`Tag not resolved for ${e} value`);
	}
	return n;
}
function Rl(e, t, { anchors: n, doc: r }) {
	if (!r.directives) return "";
	let i = [], a = (B(e) || V(e)) && e.anchor;
	a && rl(a) && (n.add(a), i.push(`&${a}`));
	let o = e.tag ?? (t.default ? null : t.tag);
	return o && i.push(r.directives.tagString(o)), i.join(" ");
}
function zl(e, t, n, r) {
	if (z(e)) return e.toString(t, n, r);
	if (Vc(e)) {
		if (t.doc.directives) return e.toString(t);
		if (t.resolvedAliases?.has(e)) throw TypeError("Cannot stringify circular structure without alias nodes");
		t.resolvedAliases ? t.resolvedAliases.add(e) : t.resolvedAliases = /* @__PURE__ */ new Set([e]), e = e.resolve(t.doc);
	}
	let i, a = H(e) ? e : t.doc.createNode(e, { onTagObj: (e) => i = e });
	i ??= Ll(t.doc.schema.tags, a);
	let o = Rl(a, i, t);
	o.length > 0 && (t.indentAtStart = (t.indentAtStart ?? 0) + o.length + 1);
	let s = typeof i.stringify == "function" ? i.stringify(a, t, n, r) : B(a) ? Fl(a, t, n, r) : a.toString(t, n, r);
	return o ? B(a) || s[0] === "{" || s[0] === "[" ? `${o} ${s}` : `${o}\n${t.indent}${s}` : s;
}
// node_modules/yaml/browser/dist/stringify/stringifyPair.js
function Bl({ key: e, value: t }, n, r, i) {
	let { allNullValues: a, doc: o, indent: s, indentStep: c, options: { commentString: l, indentSeq: u, simpleKeys: d } } = n, f = H(e) && e.comment || null;
	if (d) {
		if (f) throw Error("With simple keys, key nodes cannot have comments");
		if (V(e) || !H(e) && typeof e == "object") throw Error("With simple keys, collection cannot be used as a key value");
	}
	let p = !d && (!e || f && t == null && !n.inFlow || V(e) || (B(e) ? e.type === W.BLOCK_FOLDED || e.type === W.BLOCK_LITERAL : typeof e == "object"));
	n = Object.assign({}, n, {
		allNullValues: !1,
		implicitKey: !p && (d || !a),
		indent: s + c
	});
	let m = !1, h = !1, g = zl(e, n, () => m = !0, () => h = !0);
	if (!p && !n.inFlow && g.length > 1024) {
		if (d) throw Error("With simple keys, single line scalar must not span more than 1024 characters");
		p = !0;
	}
	if (n.inFlow) {
		if (a || t == null) return m && r && r(), g === "" ? "?" : p ? `? ${g}` : g;
	} else if (a && !d || t == null && p) return g = `? ${g}`, f && !m ? g += bl(g, n.indent, l(f)) : h && i && i(), g;
	m && (f = null), p ? (f && (g += bl(g, n.indent, l(f))), g = `? ${g}\n${s}:`) : (g = `${g}:`, f && (g += bl(g, n.indent, l(f))));
	let _, v, y;
	H(t) ? (_ = !!t.spaceBefore, v = t.commentBefore, y = t.comment) : (_ = !1, v = null, y = null, t && typeof t == "object" && (t = o.createNode(t))), n.implicitKey = !1, !p && !f && B(t) && (n.indentAtStart = g.length + 1), h = !1, !u && c.length >= 2 && !n.inFlow && !p && Wc(t) && !t.flow && !t.tag && !t.anchor && (n.indent = n.indent.substring(2));
	let ee = !1, b = zl(t, n, () => ee = !0, () => h = !0), x = " ";
	if (f || _ || v) {
		if (x = _ ? "\n" : "", v) {
			let e = l(v);
			x += `\n${yl(e, n.indent)}`;
		}
		b === "" && !n.inFlow ? x === "\n" && y && (x = "\n\n") : x += `\n${n.indent}`;
	} else if (!p && V(t)) {
		let e = b[0], r = b.indexOf("\n"), i = r !== -1, a = n.inFlow ?? t.flow ?? t.items.length === 0;
		if (i || !a) {
			let t = !1;
			if (i && (e === "&" || e === "!")) {
				let n = b.indexOf(" ");
				e === "&" && n !== -1 && n < r && b[n + 1] === "!" && (n = b.indexOf(" ", n + 1)), (n === -1 || r < n) && (t = !0);
			}
			t || (x = `\n${n.indent}`);
		}
	} else (b === "" || b[0] === "\n") && (x = "");
	return g += x + b, n.inFlow ? ee && r && r() : y && !ee ? g += bl(g, n.indent, l(y)) : h && i && i(), g;
}
// node_modules/yaml/browser/dist/log.js
function Vl(e, t) {
	(e === "debug" || e === "warn") && console.warn(t);
}
// node_modules/yaml/browser/dist/schema/yaml-1.1/merge.js
var Hl = "<<", Ul = {
	identify: (e) => e === Hl || typeof e == "symbol" && e.description === Hl,
	default: "key",
	tag: "tag:yaml.org,2002:merge",
	test: /^<<$/,
	resolve: () => Object.assign(new W(Symbol(Hl)), { addToJSMap: Gl }),
	stringify: () => Hl
}, Wl = (e, t) => (Ul.identify(t) || B(t) && (!t.type || t.type === W.PLAIN) && Ul.identify(t.value)) && e?.doc.schema.tags.some((e) => e.tag === Ul.tag && e.default);
function Gl(e, t, n) {
	let r = ql(e, n);
	if (Wc(r)) for (let n of r.items) Kl(e, t, n);
	else if (Array.isArray(r)) for (let n of r) Kl(e, t, n);
	else Kl(e, t, r);
}
function Kl(e, t, n) {
	let r = ql(e, n);
	if (!Uc(r)) throw Error("Merge sources must be maps or map aliases");
	let i = r.toJSON(null, e, Map);
	for (let [e, n] of i) t instanceof Map ? t.has(e) || t.set(e, n) : t instanceof Set ? t.add(e) : Object.prototype.hasOwnProperty.call(t, e) || Object.defineProperty(t, e, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
	return t;
}
function ql(e, t) {
	return e && Vc(t) ? t.resolve(e.doc, e) : t;
}
// node_modules/yaml/browser/dist/nodes/addPairToJSMap.js
function Jl(e, t, { key: n, value: r }) {
	if (H(n) && n.addToJSMap) n.addToJSMap(e, t, r);
	else if (Wl(e, n)) Gl(e, t, r);
	else {
		let i = U(n, "", e);
		if (t instanceof Map) t.set(i, U(r, i, e));
		else if (t instanceof Set) t.add(i);
		else {
			let a = Yl(n, i, e), o = U(r, a, e);
			a in t ? Object.defineProperty(t, a, {
				value: o,
				writable: !0,
				enumerable: !0,
				configurable: !0
			}) : t[a] = o;
		}
	}
	return t;
}
function Yl(e, t, n) {
	if (t === null) return "";
	if (typeof t != "object") return String(t);
	if (H(e) && n?.doc) {
		let t = Il(n.doc, {});
		t.anchors = /* @__PURE__ */ new Set();
		for (let e of n.anchors.keys()) t.anchors.add(e.anchor);
		t.inFlow = !0, t.inStringifyKey = !0;
		let r = e.toString(t);
		if (!n.mapKeyWarned) {
			let e = JSON.stringify(r);
			e.length > 40 && (e = e.substring(0, 36) + "...\""), Vl(n.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${e}. Set mapAsMap: true to use object keys.`), n.mapKeyWarned = !0;
		}
		return r;
	}
	return JSON.stringify(t);
}
// node_modules/yaml/browser/dist/nodes/Pair.js
function Xl(e, t, n) {
	return new G(ml(e, void 0, n), ml(t, void 0, n));
}
var G = class e {
	constructor(e, t = null) {
		Object.defineProperty(this, Bc, { value: Lc }), this.key = e, this.value = t;
	}
	clone(t) {
		let { key: n, value: r } = this;
		return H(n) && (n = n.clone(t)), H(r) && (r = r.clone(t)), new e(n, r);
	}
	toJSON(e, t) {
		return Jl(t, t?.mapAsMap ? /* @__PURE__ */ new Map() : {}, this);
	}
	toString(e, t, n) {
		return e?.doc ? Bl(this, e, t, n) : JSON.stringify(this);
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyCollection.js
function Zl(e, t, n) {
	return (t.inFlow ?? e.flow ? $l : Ql)(e, t, n);
}
function Ql({ comment: e, items: t }, n, { blockItemPrefix: r, flowChars: i, itemIndent: a, onChompKeep: o, onComment: s }) {
	let { indent: c, options: { commentString: l } } = n, u = Object.assign({}, n, {
		indent: a,
		type: null
	}), d = !1, f = [];
	for (let e = 0; e < t.length; ++e) {
		let i = t[e], o = null;
		if (H(i)) !d && i.spaceBefore && f.push(""), eu(n, f, i.commentBefore, d), i.comment && (o = i.comment);
		else if (z(i)) {
			let e = H(i.key) ? i.key : null;
			e && (!d && e.spaceBefore && f.push(""), eu(n, f, e.commentBefore, d));
		}
		d = !1;
		let s = zl(i, u, () => o = null, () => d = !0);
		o && (s += bl(s, a, l(o))), d && o && (d = !1), f.push(r + s);
	}
	let p;
	if (f.length === 0) p = i.start + i.end;
	else {
		p = f[0];
		for (let e = 1; e < f.length; ++e) {
			let t = f[e];
			p += t ? `\n${c}${t}` : "\n";
		}
	}
	return e ? (p += "\n" + yl(l(e), c), s && s()) : d && o && o(), p;
}
function $l({ items: e }, t, { flowChars: n, itemIndent: r }) {
	let { indent: i, indentStep: a, flowCollectionPadding: o, options: { commentString: s } } = t;
	r += a;
	let c = Object.assign({}, t, {
		indent: r,
		inFlow: !0,
		type: null
	}), l = !1, u = 0, d = [];
	for (let n = 0; n < e.length; ++n) {
		let i = e[n], a = null;
		if (H(i)) i.spaceBefore && d.push(""), eu(t, d, i.commentBefore, !1), i.comment && (a = i.comment);
		else if (z(i)) {
			let e = H(i.key) ? i.key : null;
			e && (e.spaceBefore && d.push(""), eu(t, d, e.commentBefore, !1), e.comment && (l = !0));
			let n = H(i.value) ? i.value : null;
			n ? (n.comment && (a = n.comment), n.commentBefore && (l = !0)) : i.value == null && e?.comment && (a = e.comment);
		}
		a && (l = !0);
		let o = zl(i, c, () => a = null);
		l ||= d.length > u || o.includes("\n"), n < e.length - 1 ? o += "," : t.options.trailingComma && (t.options.lineWidth > 0 && (l ||= d.reduce((e, t) => e + t.length + 2, 2) + (o.length + 2) > t.options.lineWidth), l && (o += ",")), a && (o += bl(o, r, s(a))), d.push(o), u = d.length;
	}
	let { start: f, end: p } = n;
	if (d.length === 0) return f + p;
	if (!l) {
		let e = d.reduce((e, t) => e + t.length + 2, 2);
		l = t.options.lineWidth > 0 && e > t.options.lineWidth;
	}
	if (l) {
		let e = f;
		for (let t of d) e += t ? `\n${a}${i}${t}` : "\n";
		return `${e}\n${i}${p}`;
	}
	return `${f}${o}${d.join(" ")}${o}${p}`;
}
function eu({ indent: e, options: { commentString: t } }, n, r, i) {
	if (r && i && (r = r.replace(/^\n+/, "")), r) {
		let i = yl(t(r), e);
		n.push(i.trimStart());
	}
}
// node_modules/yaml/browser/dist/nodes/YAMLMap.js
function tu(e, t) {
	let n = B(t) ? t.value : t;
	for (let r of e) if (z(r) && (r.key === t || r.key === n || B(r.key) && r.key.value === n)) return r;
}
var nu = class extends _l {
	static get tagName() {
		return "tag:yaml.org,2002:map";
	}
	constructor(e) {
		super(Ic, e), this.items = [];
	}
	static from(e, t, n) {
		let { keepUndefined: r, replacer: i } = n, a = new this(e), o = (e, o) => {
			if (typeof i == "function") o = i.call(t, e, o);
			else if (Array.isArray(i) && !i.includes(e)) return;
			(o !== void 0 || r) && a.items.push(Xl(e, o, n));
		};
		if (t instanceof Map) for (let [e, n] of t) o(e, n);
		else if (t && typeof t == "object") for (let e of Object.keys(t)) o(e, t[e]);
		return typeof e.sortMapEntries == "function" && a.items.sort(e.sortMapEntries), a;
	}
	add(e, t) {
		let n;
		n = z(e) ? e : !e || typeof e != "object" || !("key" in e) ? new G(e, e?.value) : new G(e.key, e.value);
		let r = tu(this.items, n.key), i = this.schema?.sortMapEntries;
		if (r) {
			if (!t) throw Error(`Key ${n.key} already set`);
			B(r.value) && dl(n.value) ? r.value.value = n.value : r.value = n.value;
		} else if (i) {
			let e = this.items.findIndex((e) => i(n, e) < 0);
			e === -1 ? this.items.push(n) : this.items.splice(e, 0, n);
		} else this.items.push(n);
	}
	delete(e) {
		let t = tu(this.items, e);
		return t ? this.items.splice(this.items.indexOf(t), 1).length > 0 : !1;
	}
	get(e, t) {
		let n = tu(this.items, e)?.value;
		return (!t && B(n) ? n.value : n) ?? void 0;
	}
	has(e) {
		return !!tu(this.items, e);
	}
	set(e, t) {
		this.add(new G(e, t), !0);
	}
	toJSON(e, t, n) {
		let r = n ? new n() : t?.mapAsMap ? /* @__PURE__ */ new Map() : {};
		t?.onCreate && t.onCreate(r);
		for (let e of this.items) Jl(t, r, e);
		return r;
	}
	toString(e, t, n) {
		if (!e) return JSON.stringify(this);
		for (let e of this.items) if (!z(e)) throw Error(`Map items must all be pairs; found ${JSON.stringify(e)} instead`);
		return !e.allNullValues && this.hasAllNullValues(!1) && (e = Object.assign({}, e, { allNullValues: !0 })), Zl(this, e, {
			blockItemPrefix: "",
			flowChars: {
				start: "{",
				end: "}"
			},
			itemIndent: e.indent || "",
			onChompKeep: n,
			onComment: t
		});
	}
}, ru = {
	collection: "map",
	default: !0,
	nodeClass: nu,
	tag: "tag:yaml.org,2002:map",
	resolve(e, t) {
		return Uc(e) || t("Expected a mapping for this tag"), e;
	},
	createNode: (e, t, n) => nu.from(e, t, n)
}, iu = class extends _l {
	static get tagName() {
		return "tag:yaml.org,2002:seq";
	}
	constructor(e) {
		super(zc, e), this.items = [];
	}
	add(e) {
		this.items.push(e);
	}
	delete(e) {
		let t = au(e);
		return typeof t == "number" && this.items.splice(t, 1).length > 0;
	}
	get(e, t) {
		let n = au(e);
		if (typeof n != "number") return;
		let r = this.items[n];
		return !t && B(r) ? r.value : r;
	}
	has(e) {
		let t = au(e);
		return typeof t == "number" && t < this.items.length;
	}
	set(e, t) {
		let n = au(e);
		if (typeof n != "number") throw Error(`Expected a valid index, not ${e}.`);
		let r = this.items[n];
		B(r) && dl(t) ? r.value = t : this.items[n] = t;
	}
	toJSON(e, t) {
		let n = [];
		t?.onCreate && t.onCreate(n);
		let r = 0;
		for (let e of this.items) n.push(U(e, String(r++), t));
		return n;
	}
	toString(e, t, n) {
		return e ? Zl(this, e, {
			blockItemPrefix: "- ",
			flowChars: {
				start: "[",
				end: "]"
			},
			itemIndent: (e.indent || "") + "  ",
			onChompKeep: n,
			onComment: t
		}) : JSON.stringify(this);
	}
	static from(e, t, n) {
		let { replacer: r } = n, i = new this(e);
		if (t && Symbol.iterator in Object(t)) {
			let e = 0;
			for (let a of t) {
				if (typeof r == "function") {
					let n = t instanceof Set ? a : String(e++);
					a = r.call(t, n, a);
				}
				i.items.push(ml(a, void 0, n));
			}
		}
		return i;
	}
};
function au(e) {
	let t = B(e) ? e.value : e;
	return t && typeof t == "string" && (t = Number(t)), typeof t == "number" && Number.isInteger(t) && t >= 0 ? t : null;
}
// node_modules/yaml/browser/dist/schema/common/seq.js
var ou = {
	collection: "seq",
	default: !0,
	nodeClass: iu,
	tag: "tag:yaml.org,2002:seq",
	resolve(e, t) {
		return Wc(e) || t("Expected a sequence for this tag"), e;
	},
	createNode: (e, t, n) => iu.from(e, t, n)
}, su = {
	identify: (e) => typeof e == "string",
	default: !0,
	tag: "tag:yaml.org,2002:str",
	resolve: (e) => e,
	stringify(e, t, n, r) {
		return t = Object.assign({ actualString: !0 }, t), Fl(e, t, n, r);
	}
}, cu = {
	identify: (e) => e == null,
	createNode: () => new W(null),
	default: !0,
	tag: "tag:yaml.org,2002:null",
	test: /^(?:~|[Nn]ull|NULL)?$/,
	resolve: () => new W(null),
	stringify: ({ source: e }, t) => typeof e == "string" && cu.test.test(e) ? e : t.options.nullStr
}, lu = {
	identify: (e) => typeof e == "boolean",
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
	resolve: (e) => new W(e[0] === "t" || e[0] === "T"),
	stringify({ source: e, value: t }, n) {
		return e && lu.test.test(e) && t === (e[0] === "t" || e[0] === "T") ? e : t ? n.options.trueStr : n.options.falseStr;
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyNumber.js
function uu({ format: e, minFractionDigits: t, tag: n, value: r }) {
	if (typeof r == "bigint") return String(r);
	let i = typeof r == "number" ? r : Number(r);
	if (!isFinite(i)) return isNaN(i) ? ".nan" : i < 0 ? "-.inf" : ".inf";
	let a = Object.is(r, -0) ? "-0" : JSON.stringify(r);
	if (!e && t && (!n || n === "tag:yaml.org,2002:float") && /^-?\d/.test(a) && !a.includes("e")) {
		let e = a.indexOf(".");
		e < 0 && (e = a.length, a += ".");
		let n = t - (a.length - e - 1);
		for (; n-- > 0;) a += "0";
	}
	return a;
}
// node_modules/yaml/browser/dist/schema/core/float.js
var du = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
	resolve: (e) => e.slice(-3).toLowerCase() === "nan" ? NaN : e[0] === "-" ? -Infinity : Infinity,
	stringify: uu
}, fu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "EXP",
	test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
	resolve: (e) => parseFloat(e),
	stringify(e) {
		let t = Number(e.value);
		return isFinite(t) ? t.toExponential() : uu(e);
	}
}, pu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
	resolve(e) {
		let t = new W(parseFloat(e)), n = e.indexOf(".");
		return n !== -1 && e[e.length - 1] === "0" && (t.minFractionDigits = e.length - n - 1), t;
	},
	stringify: uu
}, mu = (e) => typeof e == "bigint" || Number.isInteger(e), hu = (e, t, n, { intAsBigInt: r }) => r ? BigInt(e) : parseInt(e.substring(t), n);
function gu(e, t, n) {
	let { value: r } = e;
	return mu(r) && r >= 0 ? n + r.toString(t) : uu(e);
}
var _u = {
	identify: (e) => mu(e) && e >= 0,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "OCT",
	test: /^0o[0-7]+$/,
	resolve: (e, t, n) => hu(e, 2, 8, n),
	stringify: (e) => gu(e, 8, "0o")
}, vu = {
	identify: mu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	test: /^[-+]?[0-9]+$/,
	resolve: (e, t, n) => hu(e, 0, 10, n),
	stringify: uu
}, yu = {
	identify: (e) => mu(e) && e >= 0,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "HEX",
	test: /^0x[0-9a-fA-F]+$/,
	resolve: (e, t, n) => hu(e, 2, 16, n),
	stringify: (e) => gu(e, 16, "0x")
}, bu = [
	ru,
	ou,
	su,
	cu,
	lu,
	_u,
	vu,
	yu,
	du,
	fu,
	pu
];
// node_modules/yaml/browser/dist/schema/json/schema.js
function xu(e) {
	return typeof e == "bigint" || Number.isInteger(e);
}
var Su = ({ value: e }) => JSON.stringify(e), Cu = [
	{
		identify: (e) => typeof e == "string",
		default: !0,
		tag: "tag:yaml.org,2002:str",
		resolve: (e) => e,
		stringify: Su
	},
	{
		identify: (e) => e == null,
		createNode: () => new W(null),
		default: !0,
		tag: "tag:yaml.org,2002:null",
		test: /^null$/,
		resolve: () => null,
		stringify: Su
	},
	{
		identify: (e) => typeof e == "boolean",
		default: !0,
		tag: "tag:yaml.org,2002:bool",
		test: /^true$|^false$/,
		resolve: (e) => e === "true",
		stringify: Su
	},
	{
		identify: xu,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		test: /^-?(?:0|[1-9][0-9]*)$/,
		resolve: (e, t, { intAsBigInt: n }) => n ? BigInt(e) : parseInt(e, 10),
		stringify: ({ value: e }) => xu(e) ? e.toString() : JSON.stringify(e)
	},
	{
		identify: (e) => typeof e == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
		resolve: (e) => parseFloat(e),
		stringify: Su
	}
], wu = [ru, ou].concat(Cu, {
	default: !0,
	tag: "",
	test: /^/,
	resolve(e, t) {
		return t(`Unresolved plain scalar ${JSON.stringify(e)}`), e;
	}
}), Tu = {
	identify: (e) => e instanceof Uint8Array,
	default: !1,
	tag: "tag:yaml.org,2002:binary",
	resolve(e, t) {
		if (typeof atob == "function") {
			let t = atob(e.replace(/[\n\r]/g, "")), n = new Uint8Array(t.length);
			for (let e = 0; e < t.length; ++e) n[e] = t.charCodeAt(e);
			return n;
		}
		return t("This environment does not support reading binary tags; either Buffer or atob is required"), e;
	},
	stringify({ comment: e, type: t, value: n }, r, i, a) {
		if (!n) return "";
		let o = n, s;
		if (typeof btoa == "function") {
			let e = "";
			for (let t = 0; t < o.length; ++t) e += String.fromCharCode(o[t]);
			s = btoa(e);
		} else throw Error("This environment does not support writing binary tags; either Buffer or btoa is required");
		if (t ??= W.BLOCK_LITERAL, t !== W.QUOTE_DOUBLE) {
			let e = Math.max(r.options.lineWidth - r.indent.length, r.options.minContentWidth), n = Math.ceil(s.length / e), i = Array(n);
			for (let t = 0, r = 0; t < n; ++t, r += e) i[t] = s.substr(r, e);
			s = i.join(t === W.BLOCK_LITERAL ? "\n" : " ");
		}
		return Fl({
			comment: e,
			type: t,
			value: s
		}, r, i, a);
	}
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/pairs.js
function Eu(e, t) {
	if (Wc(e)) for (let n = 0; n < e.items.length; ++n) {
		let r = e.items[n];
		if (!z(r)) {
			if (Uc(r)) {
				r.items.length > 1 && t("Each pair must have its own sequence indicator");
				let e = r.items[0] || new G(new W(null));
				if (r.commentBefore && (e.key.commentBefore = e.key.commentBefore ? `${r.commentBefore}\n${e.key.commentBefore}` : r.commentBefore), r.comment) {
					let t = e.value ?? e.key;
					t.comment = t.comment ? `${r.comment}\n${t.comment}` : r.comment;
				}
				r = e;
			}
			e.items[n] = z(r) ? r : new G(r);
		}
	}
	else t("Expected a sequence for this tag");
	return e;
}
function Du(e, t, n) {
	let { replacer: r } = n, i = new iu(e);
	i.tag = "tag:yaml.org,2002:pairs";
	let a = 0;
	if (t && Symbol.iterator in Object(t)) for (let e of t) {
		typeof r == "function" && (e = r.call(t, String(a++), e));
		let o, s;
		if (Array.isArray(e)) {
			if (e.length === 2) o = e[0], s = e[1];
			else throw TypeError(`Expected [key, value] tuple: ${e}`);
		} else if (e && e instanceof Object) {
			let t = Object.keys(e);
			if (t.length === 1) o = t[0], s = e[o];
			else throw TypeError(`Expected tuple with one key, not ${t.length} keys`);
		} else o = e;
		i.items.push(Xl(o, s, n));
	}
	return i;
}
var Ou = {
	collection: "seq",
	default: !1,
	tag: "tag:yaml.org,2002:pairs",
	resolve: Eu,
	createNode: Du
}, ku = class e extends iu {
	constructor() {
		super(), this.add = nu.prototype.add.bind(this), this.delete = nu.prototype.delete.bind(this), this.get = nu.prototype.get.bind(this), this.has = nu.prototype.has.bind(this), this.set = nu.prototype.set.bind(this), this.tag = e.tag;
	}
	toJSON(e, t) {
		if (!t) return super.toJSON(e);
		let n = /* @__PURE__ */ new Map();
		t?.onCreate && t.onCreate(n);
		for (let e of this.items) {
			let r, i;
			if (z(e) ? (r = U(e.key, "", t), i = U(e.value, r, t)) : r = U(e, "", t), n.has(r)) throw Error("Ordered maps must not include duplicate keys");
			n.set(r, i);
		}
		return n;
	}
	static from(e, t, n) {
		let r = Du(e, t, n), i = new this();
		return i.items = r.items, i;
	}
};
ku.tag = "tag:yaml.org,2002:omap";
var Au = {
	collection: "seq",
	identify: (e) => e instanceof Map,
	nodeClass: ku,
	default: !1,
	tag: "tag:yaml.org,2002:omap",
	resolve(e, t) {
		let n = Eu(e, t), r = [];
		for (let { key: e } of n.items) B(e) && (r.includes(e.value) ? t(`Ordered maps must not include duplicate keys: ${e.value}`) : r.push(e.value));
		return Object.assign(new ku(), n);
	},
	createNode: (e, t, n) => ku.from(e, t, n)
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/bool.js
function ju({ value: e, source: t }, n) {
	return t && (e ? Mu : Nu).test.test(t) ? t : e ? n.options.trueStr : n.options.falseStr;
}
var Mu = {
	identify: (e) => e === !0,
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
	resolve: () => new W(!0),
	stringify: ju
}, Nu = {
	identify: (e) => e === !1,
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
	resolve: () => new W(!1),
	stringify: ju
}, Pu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
	resolve: (e) => e.slice(-3).toLowerCase() === "nan" ? NaN : e[0] === "-" ? -Infinity : Infinity,
	stringify: uu
}, Fu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "EXP",
	test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
	resolve: (e) => parseFloat(e.replace(/_/g, "")),
	stringify(e) {
		let t = Number(e.value);
		return isFinite(t) ? t.toExponential() : uu(e);
	}
}, Iu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
	resolve(e) {
		let t = new W(parseFloat(e.replace(/_/g, ""))), n = e.indexOf(".");
		if (n !== -1) {
			let r = e.substring(n + 1).replace(/_/g, "");
			r[r.length - 1] === "0" && (t.minFractionDigits = r.length);
		}
		return t;
	},
	stringify: uu
}, Lu = (e) => typeof e == "bigint" || Number.isInteger(e);
function Ru(e, t, n, { intAsBigInt: r }) {
	let i = e[0];
	if ((i === "-" || i === "+") && (t += 1), e = e.substring(t).replace(/_/g, ""), r) {
		switch (n) {
			case 2:
				e = `0b${e}`;
				break;
			case 8:
				e = `0o${e}`;
				break;
			case 16: e = `0x${e}`;
		}
		let t = BigInt(e);
		return i === "-" ? BigInt(-1) * t : t;
	}
	let a = parseInt(e, n);
	return i === "-" ? -1 * a : a;
}
function zu(e, t, n) {
	let { value: r } = e;
	if (Lu(r)) {
		let e = r.toString(t);
		return r < 0 ? "-" + n + e.substr(1) : n + e;
	}
	return uu(e);
}
var Bu = {
	identify: Lu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "BIN",
	test: /^[-+]?0b[0-1_]+$/,
	resolve: (e, t, n) => Ru(e, 2, 2, n),
	stringify: (e) => zu(e, 2, "0b")
}, Vu = {
	identify: Lu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "OCT",
	test: /^[-+]?0[0-7_]+$/,
	resolve: (e, t, n) => Ru(e, 1, 8, n),
	stringify: (e) => zu(e, 8, "0")
}, Hu = {
	identify: Lu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	test: /^[-+]?[0-9][0-9_]*$/,
	resolve: (e, t, n) => Ru(e, 0, 10, n),
	stringify: uu
}, Uu = {
	identify: Lu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "HEX",
	test: /^[-+]?0x[0-9a-fA-F_]+$/,
	resolve: (e, t, n) => Ru(e, 2, 16, n),
	stringify: (e) => zu(e, 16, "0x")
}, Wu = class e extends nu {
	constructor(t) {
		super(t), this.tag = e.tag;
	}
	add(e) {
		let t;
		t = z(e) ? e : e && typeof e == "object" && "key" in e && "value" in e && e.value === null ? new G(e.key, null) : new G(e, null), tu(this.items, t.key) || this.items.push(t);
	}
	get(e, t) {
		let n = tu(this.items, e);
		return !t && z(n) ? B(n.key) ? n.key.value : n.key : n;
	}
	set(e, t) {
		if (typeof t != "boolean") throw Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof t}`);
		let n = tu(this.items, e);
		n && !t ? this.items.splice(this.items.indexOf(n), 1) : !n && t && this.items.push(new G(e));
	}
	toJSON(e, t) {
		return super.toJSON(e, t, Set);
	}
	toString(e, t, n) {
		if (!e) return JSON.stringify(this);
		if (this.hasAllNullValues(!0)) return super.toString(Object.assign({}, e, { allNullValues: !0 }), t, n);
		throw Error("Set items must all have null values");
	}
	static from(e, t, n) {
		let { replacer: r } = n, i = new this(e);
		if (t && Symbol.iterator in Object(t)) for (let e of t) typeof r == "function" && (e = r.call(t, e, e)), i.items.push(Xl(e, null, n));
		return i;
	}
};
Wu.tag = "tag:yaml.org,2002:set";
var Gu = {
	collection: "map",
	identify: (e) => e instanceof Set,
	nodeClass: Wu,
	default: !1,
	tag: "tag:yaml.org,2002:set",
	createNode: (e, t, n) => Wu.from(e, t, n),
	resolve(e, t) {
		if (Uc(e)) {
			if (e.hasAllNullValues(!0)) return Object.assign(new Wu(), e);
			t("Set items must all have null values");
		} else t("Expected a mapping for this tag");
		return e;
	}
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/timestamp.js
function Ku(e, t) {
	let n = e[0], r = n === "-" || n === "+" ? e.substring(1) : e, i = (e) => t ? BigInt(e) : Number(e), a = r.replace(/_/g, "").split(":").reduce((e, t) => e * i(60) + i(t), i(0));
	return n === "-" ? i(-1) * a : a;
}
function qu(e) {
	let { value: t } = e, n = (e) => e;
	if (typeof t == "bigint") n = (e) => BigInt(e);
	else if (isNaN(t) || !isFinite(t)) return uu(e);
	let r = "";
	t < 0 && (r = "-", t *= n(-1));
	let i = n(60), a = [t % i];
	return t < 60 ? a.unshift(0) : (t = (t - a[0]) / i, a.unshift(t % i), t >= 60 && (t = (t - a[0]) / i, a.unshift(t))), r + a.map((e) => String(e).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
}
var Ju = {
	identify: (e) => typeof e == "bigint" || Number.isInteger(e),
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "TIME",
	test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
	resolve: (e, t, { intAsBigInt: n }) => Ku(e, n),
	stringify: qu
}, Yu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "TIME",
	test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
	resolve: (e) => Ku(e, !1),
	stringify: qu
}, Xu = {
	identify: (e) => e instanceof Date,
	default: !0,
	tag: "tag:yaml.org,2002:timestamp",
	test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
	resolve(e) {
		let t = e.match(Xu.test);
		if (!t) throw Error("!!timestamp expects a date, starting with yyyy-mm-dd");
		let [, n, r, i, a, o, s] = t.map(Number), c = t[7] ? Number((t[7] + "00").substr(1, 3)) : 0, l = Date.UTC(n, r - 1, i, a || 0, o || 0, s || 0, c), u = t[8];
		if (u && u !== "Z") {
			let e = Ku(u, !1);
			Math.abs(e) < 30 && (e *= 60), l -= 6e4 * e;
		}
		return new Date(l);
	},
	stringify: ({ value: e }) => e?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
}, Zu = [
	ru,
	ou,
	su,
	cu,
	Mu,
	Nu,
	Bu,
	Vu,
	Hu,
	Uu,
	Pu,
	Fu,
	Iu,
	Tu,
	Ul,
	Au,
	Ou,
	Gu,
	Ju,
	Yu,
	Xu
], Qu = /* @__PURE__ */ new Map([
	["core", bu],
	["failsafe", [
		ru,
		ou,
		su
	]],
	["json", wu],
	["yaml11", Zu],
	["yaml-1.1", Zu]
]), $u = {
	binary: Tu,
	bool: lu,
	float: pu,
	floatExp: fu,
	floatNaN: du,
	floatTime: Yu,
	int: vu,
	intHex: yu,
	intOct: _u,
	intTime: Ju,
	map: ru,
	merge: Ul,
	null: cu,
	omap: Au,
	pairs: Ou,
	seq: ou,
	set: Gu,
	timestamp: Xu
}, ed = {
	"tag:yaml.org,2002:binary": Tu,
	"tag:yaml.org,2002:merge": Ul,
	"tag:yaml.org,2002:omap": Au,
	"tag:yaml.org,2002:pairs": Ou,
	"tag:yaml.org,2002:set": Gu,
	"tag:yaml.org,2002:timestamp": Xu
};
function td(e, t, n) {
	let r = Qu.get(t);
	if (r && !e) return n && !r.includes(Ul) ? r.concat(Ul) : r.slice();
	let i = r;
	if (!i) {
		if (Array.isArray(e)) i = [];
		else {
			let e = Array.from(Qu.keys()).filter((e) => e !== "yaml11").map((e) => JSON.stringify(e)).join(", ");
			throw Error(`Unknown schema "${t}"; use one of ${e} or define customTags array`);
		}
	}
	if (Array.isArray(e)) for (let t of e) i = i.concat(t);
	else typeof e == "function" && (i = e(i.slice()));
	return n && (i = i.concat(Ul)), i.reduce((e, t) => {
		let n = typeof t == "string" ? $u[t] : t;
		if (!n) {
			let e = JSON.stringify(t), n = Object.keys($u).map((e) => JSON.stringify(e)).join(", ");
			throw Error(`Unknown custom tag ${e}; use one of ${n}`);
		}
		return e.includes(n) || e.push(n), e;
	}, []);
}
// node_modules/yaml/browser/dist/schema/Schema.js
var nd = (e, t) => e.key < t.key ? -1 : +(e.key > t.key), rd = class e {
	constructor({ compat: e, customTags: t, merge: n, resolveKnownTags: r, schema: i, sortMapEntries: a, toStringDefaults: o }) {
		this.compat = Array.isArray(e) ? td(e, "compat") : e ? td(null, e) : null, this.name = typeof i == "string" && i || "core", this.knownTags = r ? ed : {}, this.tags = td(t, this.name, n), this.toStringOptions = o ?? null, Object.defineProperty(this, Ic, { value: ru }), Object.defineProperty(this, Rc, { value: su }), Object.defineProperty(this, zc, { value: ou }), this.sortMapEntries = typeof a == "function" ? a : a === !0 ? nd : null;
	}
	clone() {
		let t = Object.create(e.prototype, Object.getOwnPropertyDescriptors(this));
		return t.tags = this.tags.slice(), t;
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyDocument.js
function id(e, t) {
	let n = [], r = t.directives === !0;
	if (t.directives !== !1 && e.directives) {
		let t = e.directives.toString(e);
		t ? (n.push(t), r = !0) : e.directives.docStart && (r = !0);
	}
	r && n.push("---");
	let i = Il(e, t), { commentString: a } = i.options;
	if (e.commentBefore) {
		n.length !== 1 && n.unshift("");
		let t = a(e.commentBefore);
		n.unshift(yl(t, ""));
	}
	let o = !1, s = null;
	if (e.contents) {
		if (H(e.contents)) {
			if (e.contents.spaceBefore && r && n.push(""), e.contents.commentBefore) {
				let t = a(e.contents.commentBefore);
				n.push(yl(t, ""));
			}
			i.forceBlockIndent = !!e.comment, s = e.contents.comment;
		}
		let t = s ? void 0 : () => o = !0, c = zl(e.contents, i, () => s = null, t);
		s && (c += bl(c, "", a(s))), (c[0] === "|" || c[0] === ">") && n[n.length - 1] === "---" ? n[n.length - 1] = `--- ${c}` : n.push(c);
	} else n.push(zl(e.contents, i));
	if (e.directives?.docEnd) {
		if (e.comment) {
			let t = a(e.comment);
			t.includes("\n") ? (n.push("..."), n.push(yl(t, ""))) : n.push(`... ${t}`);
		} else n.push("...");
	} else {
		let t = e.comment;
		t && o && (t = t.replace(/^\n+/, "")), t && ((!o || s) && n[n.length - 1] !== "" && n.push(""), n.push(yl(a(t), "")));
	}
	return n.join("\n") + "\n";
}
// node_modules/yaml/browser/dist/doc/Document.js
var ad = class e {
	constructor(e, t, n) {
		this.commentBefore = null, this.comment = null, this.errors = [], this.warnings = [], Object.defineProperty(this, Bc, { value: Fc });
		let r = null;
		typeof t == "function" || Array.isArray(t) ? r = t : n === void 0 && t && (n = t, t = void 0);
		let i = Object.assign({
			intAsBigInt: !1,
			keepSourceTokens: !1,
			logLevel: "warn",
			prettyErrors: !0,
			strict: !0,
			stringKeys: !1,
			uniqueKeys: !0,
			version: "1.2"
		}, n);
		this.options = i;
		let { version: a } = i;
		n?._directives ? (this.directives = n._directives.atDocument(), this.directives.yaml.explicit && (a = this.directives.yaml.version)) : this.directives = new nl({ version: a }), this.setSchema(a, n), this.contents = e === void 0 ? null : this.createNode(e, r, n);
	}
	clone() {
		let t = Object.create(e.prototype, { [Bc]: { value: Fc } });
		return t.commentBefore = this.commentBefore, t.comment = this.comment, t.errors = this.errors.slice(), t.warnings = this.warnings.slice(), t.options = Object.assign({}, this.options), this.directives && (t.directives = this.directives.clone()), t.schema = this.schema.clone(), t.contents = H(this.contents) ? this.contents.clone(t.schema) : this.contents, this.range && (t.range = this.range.slice()), t;
	}
	add(e) {
		od(this.contents) && this.contents.add(e);
	}
	addIn(e, t) {
		od(this.contents) && this.contents.addIn(e, t);
	}
	createAlias(e, t) {
		if (!e.anchor) {
			let n = il(this);
			e.anchor = !t || n.has(t) ? al(t || "a", n) : t;
		}
		return new ll(e.anchor);
	}
	createNode(e, t, n) {
		let r;
		if (typeof t == "function") e = t.call({ "": e }, "", e), r = t;
		else if (Array.isArray(t)) {
			let e = t.filter((e) => typeof e == "number" || e instanceof String || e instanceof Number).map(String);
			e.length > 0 && (t = t.concat(e)), r = t;
		} else n === void 0 && t && (n = t, t = void 0);
		let { aliasDuplicateObjects: i, anchorPrefix: a, flow: o, keepUndefined: s, onTagObj: c, tag: l } = n ?? {}, { onAnchor: u, setAnchors: d, sourceObjects: f } = ol(this, a || "a"), p = {
			aliasDuplicateObjects: i ?? !0,
			keepUndefined: s ?? !1,
			onAnchor: u,
			onTagObj: c,
			replacer: r,
			schema: this.schema,
			sourceObjects: f
		}, m = ml(e, l, p);
		return o && V(m) && (m.flow = !0), d(), m;
	}
	createPair(e, t, n = {}) {
		return new G(this.createNode(e, null, n), this.createNode(t, null, n));
	}
	delete(e) {
		return od(this.contents) ? this.contents.delete(e) : !1;
	}
	deleteIn(e) {
		return gl(e) ? this.contents != null && (this.contents = null, !0) : od(this.contents) ? this.contents.deleteIn(e) : !1;
	}
	get(e, t) {
		return V(this.contents) ? this.contents.get(e, t) : void 0;
	}
	getIn(e, t) {
		return gl(e) ? !t && B(this.contents) ? this.contents.value : this.contents : V(this.contents) ? this.contents.getIn(e, t) : void 0;
	}
	has(e) {
		return V(this.contents) ? this.contents.has(e) : !1;
	}
	hasIn(e) {
		return gl(e) ? this.contents !== void 0 : V(this.contents) ? this.contents.hasIn(e) : !1;
	}
	set(e, t) {
		this.contents == null ? this.contents = hl(this.schema, [e], t) : od(this.contents) && this.contents.set(e, t);
	}
	setIn(e, t) {
		gl(e) ? this.contents = t : this.contents == null ? this.contents = hl(this.schema, Array.from(e), t) : od(this.contents) && this.contents.setIn(e, t);
	}
	setSchema(e, t = {}) {
		typeof e == "number" && (e = String(e));
		let n;
		switch (e) {
			case "1.1":
				this.directives ? this.directives.yaml.version = "1.1" : this.directives = new nl({ version: "1.1" }), n = {
					resolveKnownTags: !1,
					schema: "yaml-1.1"
				};
				break;
			case "1.2":
			case "next":
				this.directives ? this.directives.yaml.version = e : this.directives = new nl({ version: e }), n = {
					resolveKnownTags: !0,
					schema: "core"
				};
				break;
			case null:
				this.directives && delete this.directives, n = null;
				break;
			default: {
				let t = JSON.stringify(e);
				throw Error(`Expected '1.1', '1.2' or null as first argument, but found: ${t}`);
			}
		}
		if (t.schema instanceof Object) this.schema = t.schema;
		else if (n) this.schema = new rd(Object.assign(n, t));
		else throw Error("With a null YAML version, the { schema: Schema } option is required");
	}
	toJS({ json: e, jsonArg: t, mapAsMap: n, maxAliasCount: r, onAnchor: i, reviver: a } = {}) {
		let o = {
			anchors: /* @__PURE__ */ new Map(),
			doc: this,
			keep: !e,
			mapAsMap: n === !0,
			mapKeyWarned: !1,
			maxAliasCount: typeof r == "number" ? r : 100
		}, s = U(this.contents, t ?? "", o);
		if (typeof i == "function") for (let { count: e, res: t } of o.anchors.values()) i(t, e);
		return typeof a == "function" ? sl(a, { "": s }, "", s) : s;
	}
	toJSON(e, t) {
		return this.toJS({
			json: !0,
			jsonArg: e,
			mapAsMap: !1,
			onAnchor: t
		});
	}
	toString(e = {}) {
		if (this.errors.length > 0) throw Error("Document with errors cannot be stringified");
		if ("indent" in e && (!Number.isInteger(e.indent) || Number(e.indent) <= 0)) {
			let t = JSON.stringify(e.indent);
			throw Error(`"indent" option must be a positive integer, not ${t}`);
		}
		return id(this, e);
	}
};
function od(e) {
	if (V(e)) return !0;
	throw Error("Expected a YAML collection as document contents");
}
// node_modules/yaml/browser/dist/errors.js
var sd = class extends Error {
	constructor(e, t, n, r) {
		super(), this.name = e, this.code = n, this.message = r, this.pos = t;
	}
}, cd = class extends sd {
	constructor(e, t, n) {
		super("YAMLParseError", e, t, n);
	}
}, ld = class extends sd {
	constructor(e, t, n) {
		super("YAMLWarning", e, t, n);
	}
}, ud = (e, t) => (n) => {
	if (n.pos[0] === -1) return;
	n.linePos = n.pos.map((e) => t.linePos(e));
	let { line: r, col: i } = n.linePos[0];
	n.message += ` at line ${r}, column ${i}`;
	let a = i - 1, o = e.substring(t.lineStarts[r - 1], t.lineStarts[r]).replace(/[\n\r]+$/, "");
	if (a >= 60 && o.length > 80) {
		let e = Math.min(a - 39, o.length - 79);
		o = "…" + o.substring(e), a -= e - 1;
	}
	if (o.length > 80 && (o = o.substring(0, 79) + "…"), r > 1 && /^ *$/.test(o.substring(0, a))) {
		let n = e.substring(t.lineStarts[r - 2], t.lineStarts[r - 1]);
		n.length > 80 && (n = n.substring(0, 79) + "…\n"), o = n + o;
	}
	if (/[^ ]/.test(o)) {
		let e = 1, t = n.linePos[1];
		t?.line === r && t.col > i && (e = Math.max(1, Math.min(t.col - i, 80 - a)));
		let s = " ".repeat(a) + "^".repeat(e);
		n.message += `:\n\n${o}\n${s}\n`;
	}
};
// node_modules/yaml/browser/dist/compose/resolve-props.js
function dd(e, { flow: t, indicator: n, next: r, offset: i, onError: a, parentIndent: o, startOnNewline: s }) {
	let c = !1, l = s, u = s, d = "", f = "", p = !1, m = !1, h = null, g = null, _ = null, v = null, y = null, ee = null, b = null;
	for (let i of e) switch (m &&= (i.type !== "space" && i.type !== "newline" && i.type !== "comma" && a(i.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space"), !1), h &&= (l && i.type !== "comment" && i.type !== "newline" && a(h, "TAB_AS_INDENT", "Tabs are not allowed as indentation"), null), i.type) {
		case "space":
			!t && (n !== "doc-start" || r?.type !== "flow-collection") && i.source.includes("	") && (h = i), u = !0;
			break;
		case "comment": {
			u || a(i, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
			let e = i.source.substring(1) || " ";
			d ? d += f + e : d = e, f = "", l = !1;
			break;
		}
		case "newline":
			l ? d ? d += i.source : ee && n === "seq-item-ind" || (c = !0) : f += i.source, l = !0, p = !0, (g || _) && (v = i), u = !0;
			break;
		case "anchor":
			g && a(i, "MULTIPLE_ANCHORS", "A node can have at most one anchor"), i.source.endsWith(":") && a(i.offset + i.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", !0), g = i, b ??= i.offset, l = !1, u = !1, m = !0;
			break;
		case "tag":
			_ && a(i, "MULTIPLE_TAGS", "A node can have at most one tag"), _ = i, b ??= i.offset, l = !1, u = !1, m = !0;
			break;
		case n:
			(g || _) && a(i, "BAD_PROP_ORDER", `Anchors and tags must be after the ${i.source} indicator`), ee && a(i, "UNEXPECTED_TOKEN", `Unexpected ${i.source} in ${t ?? "collection"}`), ee = i, l = n === "seq-item-ind" || n === "explicit-key-ind", u = !1;
			break;
		case "comma": if (t) {
			y && a(i, "UNEXPECTED_TOKEN", `Unexpected , in ${t}`), y = i, l = !1, u = !1;
			break;
		}
		default: a(i, "UNEXPECTED_TOKEN", `Unexpected ${i.type} token`), l = !1, u = !1;
	}
	let x = e[e.length - 1], te = x ? x.offset + x.source.length : i;
	return m && r && r.type !== "space" && r.type !== "newline" && r.type !== "comma" && (r.type !== "scalar" || r.source !== "") && a(r.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space"), h && (l && h.indent <= o || r?.type === "block-map" || r?.type === "block-seq") && a(h, "TAB_AS_INDENT", "Tabs are not allowed as indentation"), {
		comma: y,
		found: ee,
		spaceBefore: c,
		comment: d,
		hasNewline: p,
		anchor: g,
		tag: _,
		newlineAfterProp: v,
		end: te,
		start: b ?? te
	};
}
// node_modules/yaml/browser/dist/compose/util-contains-newline.js
function fd(e) {
	if (!e) return null;
	switch (e.type) {
		case "alias":
		case "scalar":
		case "double-quoted-scalar":
		case "single-quoted-scalar":
			if (e.source.includes("\n")) return !0;
			if (e.end) {
				for (let t of e.end) if (t.type === "newline") return !0;
			}
			return !1;
		case "flow-collection":
			for (let t of e.items) {
				for (let e of t.start) if (e.type === "newline") return !0;
				if (t.sep) {
					for (let e of t.sep) if (e.type === "newline") return !0;
				}
				if (fd(t.key) || fd(t.value)) return !0;
			}
			return !1;
		default: return !0;
	}
}
// node_modules/yaml/browser/dist/compose/util-flow-indent-check.js
function pd(e, t, n) {
	if (t?.type === "flow-collection") {
		let r = t.end[0];
		r.indent === e && (r.source === "]" || r.source === "}") && fd(t) && n(r, "BAD_INDENT", "Flow end indicator should be more indented than parent", !0);
	}
}
// node_modules/yaml/browser/dist/compose/util-map-includes.js
function md(e, t, n) {
	let { uniqueKeys: r } = e.options;
	if (r === !1) return !1;
	let i = typeof r == "function" ? r : (e, t) => e === t || B(e) && B(t) && e.value === t.value;
	return t.some((e) => i(e.key, n));
}
// node_modules/yaml/browser/dist/compose/resolve-block-map.js
var hd = "All mapping items must start at the same column";
function gd({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = new ((a?.nodeClass) ?? nu)(n.schema);
	n.atRoot &&= !1;
	let s = r.offset, c = null;
	for (let a of r.items) {
		let { start: l, key: u, sep: d, value: f } = a, p = dd(l, {
			indicator: "explicit-key-ind",
			next: u ?? d?.[0],
			offset: s,
			onError: i,
			parentIndent: r.indent,
			startOnNewline: !0
		}), m = !p.found;
		if (m) {
			if (u && (u.type === "block-seq" ? i(s, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key") : "indent" in u && u.indent !== r.indent && i(s, "BAD_INDENT", hd)), !p.anchor && !p.tag && !d) {
				c = p.end, p.comment && (o.comment ? o.comment += "\n" + p.comment : o.comment = p.comment);
				continue;
			}
			(p.newlineAfterProp || fd(u)) && i(u ?? l[l.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
		} else p.found?.indent !== r.indent && i(s, "BAD_INDENT", hd);
		n.atKey = !0;
		let h = p.end, g = u ? e(n, u, p, i) : t(n, h, l, null, p, i);
		n.schema.compat && pd(r.indent, u, i), n.atKey = !1, md(n, o.items, g) && i(h, "DUPLICATE_KEY", "Map keys must be unique");
		let _ = dd(d ?? [], {
			indicator: "map-value-ind",
			next: f,
			offset: g.range[2],
			onError: i,
			parentIndent: r.indent,
			startOnNewline: !u || u.type === "block-scalar"
		});
		if (s = _.end, _.found) {
			m && (f?.type === "block-map" && !_.hasNewline && i(s, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings"), n.options.strict && p.start < _.found.offset - 1024 && i(g.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key"));
			let c = f ? e(n, f, _, i) : t(n, s, d, null, _, i);
			n.schema.compat && pd(r.indent, f, i), s = c.range[2];
			let l = new G(g, c);
			n.options.keepSourceTokens && (l.srcToken = a), o.items.push(l);
		} else {
			m && i(g.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values"), _.comment && (g.comment ? g.comment += "\n" + _.comment : g.comment = _.comment);
			let e = new G(g);
			n.options.keepSourceTokens && (e.srcToken = a), o.items.push(e);
		}
	}
	return c && c < s && i(c, "IMPOSSIBLE", "Map comment with trailing content"), o.range = [
		r.offset,
		s,
		c ?? s
	], o;
}
// node_modules/yaml/browser/dist/compose/resolve-block-seq.js
function _d({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = new ((a?.nodeClass) ?? iu)(n.schema);
	n.atRoot &&= !1, n.atKey &&= !1;
	let s = r.offset, c = null;
	for (let { start: a, value: l } of r.items) {
		let u = dd(a, {
			indicator: "seq-item-ind",
			next: l,
			offset: s,
			onError: i,
			parentIndent: r.indent,
			startOnNewline: !0
		});
		if (!u.found) {
			if (u.anchor || u.tag || l) l?.type === "block-seq" ? i(u.end, "BAD_INDENT", "All sequence items must start at the same column") : i(s, "MISSING_CHAR", "Sequence item without - indicator");
			else {
				c = u.end, u.comment && (o.comment = u.comment);
				continue;
			}
		}
		let d = l ? e(n, l, u, i) : t(n, u.end, a, null, u, i);
		n.schema.compat && pd(r.indent, l, i), s = d.range[2], o.items.push(d);
	}
	return o.range = [
		r.offset,
		s,
		c ?? s
	], o;
}
// node_modules/yaml/browser/dist/compose/resolve-end.js
function vd(e, t, n, r) {
	let i = "";
	if (e) {
		let a = !1, o = "";
		for (let s of e) {
			let { source: e, type: c } = s;
			switch (c) {
				case "space":
					a = !0;
					break;
				case "comment": {
					n && !a && r(s, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
					let t = e.substring(1) || " ";
					i ? i += o + t : i = t, o = "";
					break;
				}
				case "newline":
					i && (o += e), a = !0;
					break;
				default: r(s, "UNEXPECTED_TOKEN", `Unexpected ${c} at node end`);
			}
			t += e.length;
		}
	}
	return {
		comment: i,
		offset: t
	};
}
// node_modules/yaml/browser/dist/compose/resolve-flow-collection.js
var yd = "Block collections are not allowed within flow collections", bd = (e) => e && (e.type === "block-map" || e.type === "block-seq");
function xd({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = r.start.source === "{", s = o ? "flow map" : "flow sequence", c = new ((a?.nodeClass) ?? (o ? nu : iu))(n.schema);
	c.flow = !0;
	let l = n.atRoot;
	l && (n.atRoot = !1), n.atKey &&= !1;
	let u = r.offset + r.start.source.length;
	for (let a = 0; a < r.items.length; ++a) {
		let l = r.items[a], { start: d, key: f, sep: p, value: m } = l, h = dd(d, {
			flow: s,
			indicator: "explicit-key-ind",
			next: f ?? p?.[0],
			offset: u,
			onError: i,
			parentIndent: r.indent,
			startOnNewline: !1
		});
		if (!h.found) {
			if (!h.anchor && !h.tag && !p && !m) {
				a === 0 && h.comma ? i(h.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${s}`) : a < r.items.length - 1 && i(h.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${s}`), h.comment && (c.comment ? c.comment += "\n" + h.comment : c.comment = h.comment), u = h.end;
				continue;
			}
			!o && n.options.strict && fd(f) && i(f, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
		}
		if (a === 0) h.comma && i(h.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${s}`);
		else if (h.comma || i(h.start, "MISSING_CHAR", `Missing , between ${s} items`), h.comment) {
			let e = "";
			loop: for (let t of d) switch (t.type) {
				case "comma":
				case "space": break;
				case "comment":
					e = t.source.substring(1);
					break loop;
				default: break loop;
			}
			if (e) {
				let t = c.items[c.items.length - 1];
				z(t) && (t = t.value ?? t.key), t.comment ? t.comment += "\n" + e : t.comment = e, h.comment = h.comment.substring(e.length + 1);
			}
		}
		if (!o && !p && !h.found) {
			let r = m ? e(n, m, h, i) : t(n, h.end, p, null, h, i);
			c.items.push(r), u = r.range[2], bd(m) && i(r.range, "BLOCK_IN_FLOW", yd);
		} else {
			n.atKey = !0;
			let a = h.end, g = f ? e(n, f, h, i) : t(n, a, d, null, h, i);
			bd(f) && i(g.range, "BLOCK_IN_FLOW", yd), n.atKey = !1;
			let _ = dd(p ?? [], {
				flow: s,
				indicator: "map-value-ind",
				next: m,
				offset: g.range[2],
				onError: i,
				parentIndent: r.indent,
				startOnNewline: !1
			});
			if (_.found) {
				if (!o && !h.found && n.options.strict) {
					if (p) for (let e of p) {
						if (e === _.found) break;
						if (e.type === "newline") {
							i(e, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
							break;
						}
					}
					h.start < _.found.offset - 1024 && i(_.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
				}
			} else m && ("source" in m && m.source?.[0] === ":" ? i(m, "MISSING_CHAR", `Missing space after : in ${s}`) : i(_.start, "MISSING_CHAR", `Missing , or : between ${s} items`));
			let v = m ? e(n, m, _, i) : _.found ? t(n, _.end, p, null, _, i) : null;
			v ? bd(m) && i(v.range, "BLOCK_IN_FLOW", yd) : _.comment && (g.comment ? g.comment += "\n" + _.comment : g.comment = _.comment);
			let y = new G(g, v);
			if (n.options.keepSourceTokens && (y.srcToken = l), o) {
				let e = c;
				md(n, e.items, g) && i(a, "DUPLICATE_KEY", "Map keys must be unique"), e.items.push(y);
			} else {
				let e = new nu(n.schema);
				e.flow = !0, e.items.push(y);
				let t = (v ?? g).range;
				e.range = [
					g.range[0],
					t[1],
					t[2]
				], c.items.push(e);
			}
			u = v ? v.range[2] : _.end;
		}
	}
	let d = o ? "}" : "]", [f, ...p] = r.end, m = u;
	if (f?.source === d) m = f.offset + f.source.length;
	else {
		let e = s[0].toUpperCase() + s.substring(1), t = l ? `${e} must end with a ${d}` : `${e} in block collection must be sufficiently indented and end with a ${d}`;
		i(u, l ? "MISSING_CHAR" : "BAD_INDENT", t), f && f.source.length !== 1 && p.unshift(f);
	}
	if (p.length > 0) {
		let e = vd(p, m, n.options.strict, i);
		e.comment && (c.comment ? c.comment += "\n" + e.comment : c.comment = e.comment), c.range = [
			r.offset,
			m,
			e.offset
		];
	} else c.range = [
		r.offset,
		m,
		m
	];
	return c;
}
// node_modules/yaml/browser/dist/compose/compose-collection.js
function Sd(e, t, n, r, i, a) {
	let o = n.type === "block-map" ? gd(e, t, n, r, a) : n.type === "block-seq" ? _d(e, t, n, r, a) : xd(e, t, n, r, a), s = o.constructor;
	return i === "!" || i === s.tagName ? (o.tag = s.tagName, o) : (i && (o.tag = i), o);
}
function Cd(e, t, n, r, i) {
	let a = r.tag, o = a ? t.directives.tagName(a.source, (e) => i(a, "TAG_RESOLVE_FAILED", e)) : null;
	if (n.type === "block-seq") {
		let { anchor: e, newlineAfterProp: t } = r, n = e && a ? e.offset > a.offset ? e : a : e ?? a;
		n && (!t || t.offset < n.offset) && i(n, "MISSING_CHAR", "Missing newline after block sequence props");
	}
	let s = n.type === "block-map" ? "map" : n.type === "block-seq" ? "seq" : n.start.source === "{" ? "map" : "seq";
	if (!a || !o || o === "!" || o === nu.tagName && s === "map" || o === iu.tagName && s === "seq") return Sd(e, t, n, i, o);
	let c = t.schema.tags.find((e) => e.tag === o && e.collection === s);
	if (!c) {
		let r = t.schema.knownTags[o];
		if (r?.collection === s) t.schema.tags.push(Object.assign({}, r, { default: !1 })), c = r;
		else return r ? i(a, "BAD_COLLECTION_TYPE", `${r.tag} used for ${s} collection, but expects ${r.collection ?? "scalar"}`, !0) : i(a, "TAG_RESOLVE_FAILED", `Unresolved tag: ${o}`, !0), Sd(e, t, n, i, o);
	}
	let l = Sd(e, t, n, i, o, c), u = c.resolve?.(l, (e) => i(a, "TAG_RESOLVE_FAILED", e), t.options) ?? l, d = H(u) ? u : new W(u);
	return d.range = l.range, d.tag = o, c?.format && (d.format = c.format), d;
}
// node_modules/yaml/browser/dist/compose/resolve-block-scalar.js
function wd(e, t, n) {
	let r = t.offset, i = Td(t, e.options.strict, n);
	if (!i) return {
		value: "",
		type: null,
		comment: "",
		range: [
			r,
			r,
			r
		]
	};
	let a = i.mode === ">" ? W.BLOCK_FOLDED : W.BLOCK_LITERAL, o = t.source ? Ed(t.source) : [], s = o.length;
	for (let e = o.length - 1; e >= 0; --e) {
		let t = o[e][1];
		if (t === "" || t === "\r") s = e;
		else break;
	}
	if (s === 0) {
		let e = i.chomp === "+" && o.length > 0 ? "\n".repeat(Math.max(1, o.length - 1)) : "", n = r + i.length;
		return t.source && (n += t.source.length), {
			value: e,
			type: a,
			comment: i.comment,
			range: [
				r,
				n,
				n
			]
		};
	}
	let c = t.indent + i.indent, l = t.offset + i.length, u = 0;
	for (let t = 0; t < s; ++t) {
		let [r, a] = o[t];
		if (a === "" || a === "\r") i.indent === 0 && r.length > c && (c = r.length);
		else {
			r.length < c && n(l + r.length, "MISSING_CHAR", "Block scalars with more-indented leading empty lines must use an explicit indentation indicator"), i.indent === 0 && (c = r.length), u = t, c === 0 && !e.atRoot && n(l, "BAD_INDENT", "Block scalar values in collections must be indented");
			break;
		}
		l += r.length + a.length + 1;
	}
	for (let e = o.length - 1; e >= s; --e) o[e][0].length > c && (s = e + 1);
	let d = "", f = "", p = !1;
	for (let e = 0; e < u; ++e) d += o[e][0].slice(c) + "\n";
	for (let e = u; e < s; ++e) {
		let [t, r] = o[e];
		l += t.length + r.length + 1;
		let s = r[r.length - 1] === "\r";
		/* istanbul ignore if already caught in lexer */
		if (s && (r = r.slice(0, -1)), r && t.length < c) {
			let e = `Block scalar lines must not be less indented than their ${i.indent ? "explicit indentation indicator" : "first line"}`;
			n(l - r.length - (s ? 2 : 1), "BAD_INDENT", e), t = "";
		}
		a === W.BLOCK_LITERAL ? (d += f + t.slice(c) + r, f = "\n") : t.length > c || r[0] === "	" ? (f === " " ? f = "\n" : !p && f === "\n" && (f = "\n\n"), d += f + t.slice(c) + r, f = "\n", p = !0) : r === "" ? f === "\n" ? d += "\n" : f = "\n" : (d += f + r, f = " ", p = !1);
	}
	switch (i.chomp) {
		case "-": break;
		case "+":
			for (let e = s; e < o.length; ++e) d += "\n" + o[e][0].slice(c);
			d[d.length - 1] !== "\n" && (d += "\n");
			break;
		default: d += "\n";
	}
	let m = r + i.length + t.source.length;
	return {
		value: d,
		type: a,
		comment: i.comment,
		range: [
			r,
			m,
			m
		]
	};
}
function Td({ offset: e, props: t }, n, r) {
	/* istanbul ignore if should not happen */
	if (t[0].type !== "block-scalar-header") return r(t[0], "IMPOSSIBLE", "Block scalar header not found"), null;
	let { source: i } = t[0], a = i[0], o = 0, s = "", c = -1;
	for (let t = 1; t < i.length; ++t) {
		let n = i[t];
		if (!s && (n === "-" || n === "+")) s = n;
		else {
			let r = Number(n);
			!o && r ? o = r : c === -1 && (c = e + t);
		}
	}
	c !== -1 && r(c, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${i}`);
	let l = !1, u = "", d = i.length;
	for (let e = 1; e < t.length; ++e) {
		let i = t[e];
		switch (i.type) {
			case "space": l = !0;
			case "newline":
				d += i.source.length;
				break;
			case "comment":
				n && !l && r(i, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters"), d += i.source.length, u = i.source.substring(1);
				break;
			case "error":
				r(i, "UNEXPECTED_TOKEN", i.message), d += i.source.length;
				break;
			/* istanbul ignore next should not happen */
			default: {
				r(i, "UNEXPECTED_TOKEN", `Unexpected token in block scalar header: ${i.type}`);
				let e = i.source;
				e && typeof e == "string" && (d += e.length);
			}
		}
	}
	return {
		mode: a,
		indent: o,
		chomp: s,
		comment: u,
		length: d
	};
}
function Ed(e) {
	let t = e.split(/\n( *)/), n = t[0], r = n.match(/^( *)/), i = [r?.[1] ? [r[1], n.slice(r[1].length)] : ["", n]];
	for (let e = 1; e < t.length; e += 2) i.push([t[e], t[e + 1]]);
	return i;
}
// node_modules/yaml/browser/dist/compose/resolve-flow-scalar.js
function Dd(e, t, n) {
	let { offset: r, type: i, source: a, end: o } = e, s, c, l = (e, t, i) => n(r + e, t, i);
	switch (i) {
		case "scalar":
			s = W.PLAIN, c = Od(a, l);
			break;
		case "single-quoted-scalar":
			s = W.QUOTE_SINGLE, c = kd(a, l);
			break;
		case "double-quoted-scalar":
			s = W.QUOTE_DOUBLE, c = jd(a, l);
			break;
		/* istanbul ignore next should not happen */
		default: return n(e, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${i}`), {
			value: "",
			type: null,
			comment: "",
			range: [
				r,
				r + a.length,
				r + a.length
			]
		};
	}
	let u = r + a.length, d = vd(o, u, t, n);
	return {
		value: c,
		type: s,
		comment: d.comment,
		range: [
			r,
			u,
			d.offset
		]
	};
}
function Od(e, t) {
	let n = "";
	switch (e[0]) {
		/* istanbul ignore next should not happen */
		case "	":
			n = "a tab character";
			break;
		case ",":
			n = "flow indicator character ,";
			break;
		case "%":
			n = "directive indicator character %";
			break;
		case "|":
		case ">":
			n = `block scalar indicator ${e[0]}`;
			break;
		case "@":
		case "`": n = `reserved character ${e[0]}`;
	}
	return n && t(0, "BAD_SCALAR_START", `Plain value cannot start with ${n}`), Ad(e);
}
function kd(e, t) {
	return (e[e.length - 1] !== "'" || e.length === 1) && t(e.length, "MISSING_CHAR", "Missing closing 'quote"), Ad(e.slice(1, -1)).replace(/''/g, "'");
}
function Ad(e) {
	let t = /(.*?)\r?\n/sy, n = t.exec(e);
	if (!n) return e;
	let r, i;
	try {
		r = /* @__PURE__ */ RegExp("(?<![ 	])[ 	]+$"), i = /* @__PURE__ */ RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
	} catch {
		r = /[ \t]+$/, i = /^[ \t]+|[ \t]+$/g;
	}
	let a = n[1].replace(r, ""), o = " ", s = t.lastIndex;
	for (; n = t.exec(e);) {
		let e = n[1].replace(i, "");
		e === "" ? o === "\n" ? a += o : o = "\n" : (a += o + e, o = " "), s = t.lastIndex;
	}
	let c = /[ \t]*(.*)/sy;
	return c.lastIndex = s, n = c.exec(e), a + o + (n?.[1] ?? "");
}
function jd(e, t) {
	let n = "";
	for (let r = 1; r < e.length - 1; ++r) {
		let i = e[r];
		if (i !== "\r" || e[r + 1] !== "\n") {
			if (i === "\n") {
				let { fold: t, offset: i } = Md(e, r);
				n += t, r = i;
			} else if (i === "\\") {
				let i = e[++r], a = Nd[i];
				if (a) n += a;
				else if (i === "\n") for (i = e[r + 1]; i === " " || i === "	";) i = e[++r + 1];
				else if (i === "\r" && e[r + 1] === "\n") for (i = e[++r + 1]; i === " " || i === "	";) i = e[++r + 1];
				else if (i === "x" || i === "u" || i === "U") {
					let a = i === "x" ? 2 : i === "u" ? 4 : 8;
					n += Pd(e, r + 1, a, t), r += a;
				} else {
					let i = e.substr(r - 1, 2);
					t(r - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${i}`), n += i;
				}
			} else if (i === " " || i === "	") {
				let t = r, a = e[r + 1];
				for (; a === " " || a === "	";) a = e[++r + 1];
				a !== "\n" && (a !== "\r" || e[r + 2] !== "\n") && (n += r > t ? e.slice(t, r + 1) : i);
			} else n += i;
		}
	}
	return (e[e.length - 1] !== "\"" || e.length === 1) && t(e.length, "MISSING_CHAR", "Missing closing \"quote"), n;
}
function Md(e, t) {
	let n = "", r = e[t + 1];
	for (; (r === " " || r === "	" || r === "\n" || r === "\r") && (r !== "\r" || e[t + 2] === "\n");) r === "\n" && (n += "\n"), t += 1, r = e[t + 1];
	return n ||= " ", {
		fold: n,
		offset: t
	};
}
var Nd = {
	0: "\0",
	a: "\x07",
	b: "\b",
	e: "\x1B",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "	",
	v: "\v",
	N: "",
	_: "\xA0",
	L: "\u2028",
	P: "\u2029",
	" ": " ",
	"\"": "\"",
	"/": "/",
	"\\": "\\",
	"	": "	"
};
function Pd(e, t, n, r) {
	let i = e.substr(t, n), a = i.length === n && /^[0-9a-fA-F]+$/.test(i) ? parseInt(i, 16) : NaN;
	try {
		return String.fromCodePoint(a);
	} catch {
		let i = e.substr(t - 2, n + 2);
		return r(t - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${i}`), i;
	}
}
// node_modules/yaml/browser/dist/compose/compose-scalar.js
function Fd(e, t, n, r) {
	let { value: i, type: a, comment: o, range: s } = t.type === "block-scalar" ? wd(e, t, r) : Dd(t, e.options.strict, r), c = n ? e.directives.tagName(n.source, (e) => r(n, "TAG_RESOLVE_FAILED", e)) : null, l;
	l = e.options.stringKeys && e.atKey ? e.schema[Rc] : c ? Id(e.schema, i, c, n, r) : t.type === "scalar" ? Ld(e, i, t, r) : e.schema[Rc];
	let u;
	try {
		let a = l.resolve(i, (e) => r(n ?? t, "TAG_RESOLVE_FAILED", e), e.options);
		u = B(a) ? a : new W(a);
	} catch (e) {
		let a = e instanceof Error ? e.message : String(e);
		r(n ?? t, "TAG_RESOLVE_FAILED", a), u = new W(i);
	}
	return u.range = s, u.source = i, a && (u.type = a), c && (u.tag = c), l.format && (u.format = l.format), o && (u.comment = o), u;
}
function Id(e, t, n, r, i) {
	if (n === "!") return e[Rc];
	let a = [];
	for (let t of e.tags) if (!t.collection && t.tag === n) {
		if (t.default && t.test) a.push(t);
		else return t;
	}
	for (let e of a) if (e.test?.test(t)) return e;
	let o = e.knownTags[n];
	return o && !o.collection ? (e.tags.push(Object.assign({}, o, {
		default: !1,
		test: void 0
	})), o) : (i(r, "TAG_RESOLVE_FAILED", `Unresolved tag: ${n}`, n !== "tag:yaml.org,2002:str"), e[Rc]);
}
function Ld({ atKey: e, directives: t, schema: n }, r, i, a) {
	let o = n.tags.find((t) => (t.default === !0 || e && t.default === "key") && t.test?.test(r)) || n[Rc];
	if (n.compat) {
		let e = n.compat.find((e) => e.default && e.test?.test(r)) ?? n[Rc];
		o.tag !== e.tag && a(i, "TAG_RESOLVE_FAILED", `Value may be parsed as either ${t.tagString(o.tag)} or ${t.tagString(e.tag)}`, !0);
	}
	return o;
}
// node_modules/yaml/browser/dist/compose/util-empty-scalar-position.js
function Rd(e, t, n) {
	if (t) {
		n ??= t.length;
		for (let r = n - 1; r >= 0; --r) {
			let n = t[r];
			switch (n.type) {
				case "space":
				case "comment":
				case "newline":
					e -= n.source.length;
					continue;
			}
			for (n = t[++r]; n?.type === "space";) e += n.source.length, n = t[++r];
			break;
		}
	}
	return e;
}
// node_modules/yaml/browser/dist/compose/compose-node.js
var zd = {
	composeNode: Bd,
	composeEmptyNode: Vd
};
function Bd(e, t, n, r) {
	let i = e.atKey, { spaceBefore: a, comment: o, anchor: s, tag: c } = n, l, u = !0;
	switch (t.type) {
		case "alias":
			l = Hd(e, t, r), (s || c) && r(t, "ALIAS_PROPS", "An alias node must not specify any properties");
			break;
		case "scalar":
		case "single-quoted-scalar":
		case "double-quoted-scalar":
		case "block-scalar":
			l = Fd(e, t, c, r), s && (l.anchor = s.source.substring(1));
			break;
		case "block-map":
		case "block-seq":
		case "flow-collection":
			try {
				l = Cd(zd, e, t, n, r), s && (l.anchor = s.source.substring(1));
			} catch (e) {
				r(t, "RESOURCE_EXHAUSTION", e instanceof Error ? e.message : String(e));
			}
			break;
		default: r(t, "UNEXPECTED_TOKEN", t.type === "error" ? t.message : `Unsupported token (type: ${t.type})`), u = !1;
	}
	return l ??= Vd(e, t.offset, void 0, null, n, r), s && l.anchor === "" && r(s, "BAD_ALIAS", "Anchor cannot be an empty string"), i && e.options.stringKeys && (!B(l) || typeof l.value != "string" || l.tag && l.tag !== "tag:yaml.org,2002:str") && r(c ?? t, "NON_STRING_KEY", "With stringKeys, all keys must be strings"), a && (l.spaceBefore = !0), o && (t.type === "scalar" && t.source === "" ? l.comment = o : l.commentBefore = o), e.options.keepSourceTokens && u && (l.srcToken = t), l;
}
function Vd(e, t, n, r, { spaceBefore: i, comment: a, anchor: o, tag: s, end: c }, l) {
	let u = Fd(e, {
		type: "scalar",
		offset: Rd(t, n, r),
		indent: -1,
		source: ""
	}, s, l);
	return o && (u.anchor = o.source.substring(1), u.anchor === "" && l(o, "BAD_ALIAS", "Anchor cannot be an empty string")), i && (u.spaceBefore = !0), a && (u.comment = a, u.range[2] = c), u;
}
function Hd({ options: e }, { offset: t, source: n, end: r }, i) {
	let a = new ll(n.substring(1));
	a.source === "" && i(t, "BAD_ALIAS", "Alias cannot be an empty string"), a.source.endsWith(":") && i(t + n.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", !0);
	let o = t + n.length, s = vd(r, o, e.strict, i);
	return a.range = [
		t,
		o,
		s.offset
	], s.comment && (a.comment = s.comment), a;
}
// node_modules/yaml/browser/dist/compose/compose-doc.js
function Ud(e, t, { offset: n, start: r, value: i, end: a }, o) {
	let s = new ad(void 0, Object.assign({ _directives: t }, e)), c = {
		atKey: !1,
		atRoot: !0,
		directives: s.directives,
		options: s.options,
		schema: s.schema
	}, l = dd(r, {
		indicator: "doc-start",
		next: i ?? a?.[0],
		offset: n,
		onError: o,
		parentIndent: 0,
		startOnNewline: !0
	});
	l.found && (s.directives.docStart = !0, i && (i.type === "block-map" || i.type === "block-seq") && !l.hasNewline && o(l.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker")), s.contents = i ? Bd(c, i, l, o) : Vd(c, l.end, r, null, l, o);
	let u = s.contents.range[2], d = vd(a, u, !1, o);
	return d.comment && (s.comment = d.comment), s.range = [
		n,
		u,
		d.offset
	], s;
}
// node_modules/yaml/browser/dist/compose/composer.js
function Wd(e) {
	if (typeof e == "number") return [e, e + 1];
	if (Array.isArray(e)) return e.length === 2 ? e : [e[0], e[1]];
	let { offset: t, source: n } = e;
	return [t, t + (typeof n == "string" ? n.length : 1)];
}
function Gd(e) {
	let t = "", n = !1, r = !1;
	for (let i = 0; i < e.length; ++i) {
		let a = e[i];
		switch (a[0]) {
			case "#":
				t += (t === "" ? "" : r ? "\n\n" : "\n") + (a.substring(1) || " "), n = !0, r = !1;
				break;
			case "%":
				e[i + 1]?.[0] !== "#" && (i += 1), n = !1;
				break;
			default: n || (r = !0), n = !1;
		}
	}
	return {
		comment: t,
		afterEmptyLine: r
	};
}
var Kd = class {
	constructor(e = {}) {
		this.doc = null, this.atDirectives = !1, this.prelude = [], this.errors = [], this.warnings = [], this.onError = (e, t, n, r) => {
			let i = Wd(e);
			r ? this.warnings.push(new ld(i, t, n)) : this.errors.push(new cd(i, t, n));
		}, this.directives = new nl({ version: e.version || "1.2" }), this.options = e;
	}
	decorate(e, t) {
		let { comment: n, afterEmptyLine: r } = Gd(this.prelude);
		if (n) {
			let i = e.contents;
			if (t) e.comment = e.comment ? `${e.comment}\n${n}` : n;
			else if (r || e.directives.docStart || !i) e.commentBefore = n;
			else if (V(i) && !i.flow && i.items.length > 0) {
				let e = i.items[0];
				z(e) && (e = e.key);
				let t = e.commentBefore;
				e.commentBefore = t ? `${n}\n${t}` : n;
			} else {
				let e = i.commentBefore;
				i.commentBefore = e ? `${n}\n${e}` : n;
			}
		}
		if (t) {
			for (let t = 0; t < this.errors.length; ++t) e.errors.push(this.errors[t]);
			for (let t = 0; t < this.warnings.length; ++t) e.warnings.push(this.warnings[t]);
		} else e.errors = this.errors, e.warnings = this.warnings;
		this.prelude = [], this.errors = [], this.warnings = [];
	}
	streamInfo() {
		return {
			comment: Gd(this.prelude).comment,
			directives: this.directives,
			errors: this.errors,
			warnings: this.warnings
		};
	}
	*compose(e, t = !1, n = -1) {
		for (let t of e) yield* this.next(t);
		yield* this.end(t, n);
	}
	*next(e) {
		switch (e.type) {
			case "directive":
				this.directives.add(e.source, (t, n, r) => {
					let i = Wd(e);
					i[0] += t, this.onError(i, "BAD_DIRECTIVE", n, r);
				}), this.prelude.push(e.source), this.atDirectives = !0;
				break;
			case "document": {
				let t = Ud(this.options, this.directives, e, this.onError);
				this.atDirectives && !t.directives.docStart && this.onError(e, "MISSING_CHAR", "Missing directives-end/doc-start indicator line"), this.decorate(t, !1), this.doc && (yield this.doc), this.doc = t, this.atDirectives = !1;
				break;
			}
			case "byte-order-mark":
			case "space": break;
			case "comment":
			case "newline":
				this.prelude.push(e.source);
				break;
			case "error": {
				let t = e.source ? `${e.message}: ${JSON.stringify(e.source)}` : e.message, n = new cd(Wd(e), "UNEXPECTED_TOKEN", t);
				this.atDirectives || !this.doc ? this.errors.push(n) : this.doc.errors.push(n);
				break;
			}
			case "doc-end": {
				if (!this.doc) {
					this.errors.push(new cd(Wd(e), "UNEXPECTED_TOKEN", "Unexpected doc-end without preceding document"));
					break;
				}
				this.doc.directives.docEnd = !0;
				let t = vd(e.end, e.offset + e.source.length, this.doc.options.strict, this.onError);
				if (this.decorate(this.doc, !0), t.comment) {
					let e = this.doc.comment;
					this.doc.comment = e ? `${e}\n${t.comment}` : t.comment;
				}
				this.doc.range[2] = t.offset;
				break;
			}
			default: this.errors.push(new cd(Wd(e), "UNEXPECTED_TOKEN", `Unsupported token ${e.type}`));
		}
	}
	*end(e = !1, t = -1) {
		if (this.doc) this.decorate(this.doc, !0), yield this.doc, this.doc = null;
		else if (e) {
			let e = new ad(void 0, Object.assign({ _directives: this.directives }, this.options));
			this.atDirectives && this.onError(t, "MISSING_CHAR", "Missing directives-end indicator line"), e.range = [
				0,
				t,
				t
			], this.decorate(e, !1), yield e;
		}
	}
}, qd = Symbol("break visit"), Jd = Symbol("skip children"), Yd = Symbol("remove item");
function Xd(e, t) {
	"type" in e && e.type === "document" && (e = {
		start: e.start,
		value: e.value
	}), Zd(Object.freeze([]), e, t);
}
Xd.BREAK = qd, Xd.SKIP = Jd, Xd.REMOVE = Yd, Xd.itemAtPath = (e, t) => {
	let n = e;
	for (let [e, r] of t) {
		let t = n?.[e];
		if (t && "items" in t) n = t.items[r];
		else return;
	}
	return n;
}, Xd.parentCollection = (e, t) => {
	let n = Xd.itemAtPath(e, t.slice(0, -1)), r = t[t.length - 1][0], i = n?.[r];
	if (i && "items" in i) return i;
	throw Error("Parent collection not found");
};
function Zd(e, t, n) {
	let r = n(t, e);
	if (typeof r == "symbol") return r;
	for (let i of ["key", "value"]) {
		let a = t[i];
		if (a && "items" in a) {
			for (let t = 0; t < a.items.length; ++t) {
				let r = Zd(Object.freeze(e.concat([[i, t]])), a.items[t], n);
				if (typeof r == "number") t = r - 1;
				else if (r === qd) return qd;
				else r === Yd && (a.items.splice(t, 1), --t);
			}
			typeof r == "function" && i === "key" && (r = r(t, e));
		}
	}
	return typeof r == "function" ? r(t, e) : r;
}
function Qd(e) {
	switch (e) {
		case "﻿": return "byte-order-mark";
		case "": return "doc-mode";
		case "": return "flow-error-end";
		case "": return "scalar";
		case "---": return "doc-start";
		case "...": return "doc-end";
		case "":
		case "\n":
		case "\r\n": return "newline";
		case "-": return "seq-item-ind";
		case "?": return "explicit-key-ind";
		case ":": return "map-value-ind";
		case "{": return "flow-map-start";
		case "}": return "flow-map-end";
		case "[": return "flow-seq-start";
		case "]": return "flow-seq-end";
		case ",": return "comma";
	}
	switch (e[0]) {
		case " ":
		case "	": return "space";
		case "#": return "comment";
		case "%": return "directive-line";
		case "*": return "alias";
		case "&": return "anchor";
		case "!": return "tag";
		case "'": return "single-quoted-scalar";
		case "\"": return "double-quoted-scalar";
		case "|":
		case ">": return "block-scalar-header";
	}
	return null;
}
// node_modules/yaml/browser/dist/parse/lexer.js
function $d(e) {
	switch (e) {
		case void 0:
		case " ":
		case "\n":
		case "\r":
		case "	": return !0;
		default: return !1;
	}
}
var ef = /* @__PURE__ */ new Set("0123456789ABCDEFabcdef"), tf = /* @__PURE__ */ new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()"), nf = /* @__PURE__ */ new Set(",[]{}"), rf = /* @__PURE__ */ new Set(" ,[]{}\n\r	"), af = (e) => !e || rf.has(e), of = class {
	constructor() {
		this.atEnd = !1, this.blockScalarIndent = -1, this.blockScalarKeep = !1, this.buffer = "", this.flowKey = !1, this.flowLevel = 0, this.indentNext = 0, this.indentValue = 0, this.lineEndPos = null, this.next = null, this.pos = 0;
	}
	*lex(e, t = !1) {
		if (e) {
			if (typeof e != "string") throw TypeError("source is not a string");
			this.buffer = this.buffer ? this.buffer + e : e, this.lineEndPos = null;
		}
		this.atEnd = !t;
		let n = this.next ?? "stream";
		for (; n && (t || this.hasChars(1));) n = yield* this.parseNext(n);
	}
	atLineEnd() {
		let e = this.pos, t = this.buffer[e];
		for (; t === " " || t === "	";) t = this.buffer[++e];
		return !t || t === "#" || t === "\n" || t === "\r" && this.buffer[e + 1] === "\n";
	}
	charAt(e) {
		return this.buffer[this.pos + e];
	}
	continueScalar(e) {
		let t = this.buffer[e];
		if (this.indentNext > 0) {
			let n = 0;
			for (; t === " ";) t = this.buffer[++n + e];
			if (t === "\r") {
				let t = this.buffer[n + e + 1];
				if (t === "\n" || !t && !this.atEnd) return e + n + 1;
			}
			return t === "\n" || n >= this.indentNext || !t && !this.atEnd ? e + n : -1;
		}
		if (t === "-" || t === ".") {
			let t = this.buffer.substr(e, 3);
			if ((t === "---" || t === "...") && $d(this.buffer[e + 3])) return -1;
		}
		return e;
	}
	getLine() {
		let e = this.lineEndPos;
		return (typeof e != "number" || e !== -1 && e < this.pos) && (e = this.buffer.indexOf("\n", this.pos), this.lineEndPos = e), e === -1 ? this.atEnd ? this.buffer.substring(this.pos) : null : (this.buffer[e - 1] === "\r" && --e, this.buffer.substring(this.pos, e));
	}
	hasChars(e) {
		return this.pos + e <= this.buffer.length;
	}
	setNext(e) {
		return this.buffer = this.buffer.substring(this.pos), this.pos = 0, this.lineEndPos = null, this.next = e, null;
	}
	peek(e) {
		return this.buffer.substr(this.pos, e);
	}
	*parseNext(e) {
		switch (e) {
			case "stream": return yield* this.parseStream();
			case "line-start": return yield* this.parseLineStart();
			case "block-start": return yield* this.parseBlockStart();
			case "doc": return yield* this.parseDocument();
			case "flow": return yield* this.parseFlowCollection();
			case "quoted-scalar": return yield* this.parseQuotedScalar();
			case "block-scalar": return yield* this.parseBlockScalar();
			case "plain-scalar": return yield* this.parsePlainScalar();
		}
	}
	*parseStream() {
		let e = this.getLine();
		if (e === null) return this.setNext("stream");
		if (e[0] === "﻿" && (yield* this.pushCount(1), e = e.substring(1)), e[0] === "%") {
			let t = e.length, n = e.indexOf("#");
			for (; n !== -1;) {
				let r = e[n - 1];
				if (r === " " || r === "	") {
					t = n - 1;
					break;
				}
				n = e.indexOf("#", n + 1);
			}
			for (;;) {
				let n = e[t - 1];
				if (n === " " || n === "	") --t;
				else break;
			}
			let r = (yield* this.pushCount(t)) + (yield* this.pushSpaces(!0));
			return yield* this.pushCount(e.length - r), this.pushNewline(), "stream";
		}
		if (this.atLineEnd()) {
			let t = yield* this.pushSpaces(!0);
			return yield* this.pushCount(e.length - t), yield* this.pushNewline(), "stream";
		}
		return yield "", yield* this.parseLineStart();
	}
	*parseLineStart() {
		let e = this.charAt(0);
		if (!e && !this.atEnd) return this.setNext("line-start");
		if (e === "-" || e === ".") {
			if (!this.atEnd && !this.hasChars(4)) return this.setNext("line-start");
			let e = this.peek(3);
			if ((e === "---" || e === "...") && $d(this.charAt(3))) return yield* this.pushCount(3), this.indentValue = 0, this.indentNext = 0, e === "---" ? "doc" : "stream";
		}
		return this.indentValue = yield* this.pushSpaces(!1), this.indentNext > this.indentValue && !$d(this.charAt(1)) && (this.indentNext = this.indentValue), yield* this.parseBlockStart();
	}
	*parseBlockStart() {
		let [e, t] = this.peek(2);
		if (!t && !this.atEnd) return this.setNext("block-start");
		if ((e === "-" || e === "?" || e === ":") && $d(t)) {
			let e = (yield* this.pushCount(1)) + (yield* this.pushSpaces(!0));
			return this.indentNext = this.indentValue + 1, this.indentValue += e, "block-start";
		}
		return "doc";
	}
	*parseDocument() {
		yield* this.pushSpaces(!0);
		let e = this.getLine();
		if (e === null) return this.setNext("doc");
		let t = yield* this.pushIndicators();
		switch (e[t]) {
			case "#": yield* this.pushCount(e.length - t);
			case void 0: return yield* this.pushNewline(), yield* this.parseLineStart();
			case "{":
			case "[": return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel = 1, "flow";
			case "}":
			case "]": return yield* this.pushCount(1), "doc";
			case "*": return yield* this.pushUntil(af), "doc";
			case "\"":
			case "'": return yield* this.parseQuotedScalar();
			case "|":
			case ">": return t += yield* this.parseBlockScalarHeader(), t += yield* this.pushSpaces(!0), yield* this.pushCount(e.length - t), yield* this.pushNewline(), yield* this.parseBlockScalar();
			default: return yield* this.parsePlainScalar();
		}
	}
	*parseFlowCollection() {
		let e, t, n = -1;
		do
			e = yield* this.pushNewline(), e > 0 ? (t = yield* this.pushSpaces(!1), this.indentValue = n = t) : t = 0, t += yield* this.pushSpaces(!0);
		while (e + t > 0);
		let r = this.getLine();
		if (r === null) return this.setNext("flow");
		if ((n !== -1 && n < this.indentNext && r[0] !== "#" || n === 0 && (r.startsWith("---") || r.startsWith("...")) && $d(r[3])) && (n !== this.indentNext - 1 || this.flowLevel !== 1 || r[0] !== "]" && r[0] !== "}")) return this.flowLevel = 0, yield "", yield* this.parseLineStart();
		let i = 0;
		for (; r[i] === ",";) i += yield* this.pushCount(1), i += yield* this.pushSpaces(!0), this.flowKey = !1;
		switch (i += yield* this.pushIndicators(), r[i]) {
			case void 0: return "flow";
			case "#": return yield* this.pushCount(r.length - i), "flow";
			case "{":
			case "[": return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel += 1, "flow";
			case "}":
			case "]": return yield* this.pushCount(1), this.flowKey = !0, --this.flowLevel, this.flowLevel ? "flow" : "doc";
			case "*": return yield* this.pushUntil(af), "flow";
			case "\"":
			case "'": return this.flowKey = !0, yield* this.parseQuotedScalar();
			case ":": {
				let e = this.charAt(1);
				if (this.flowKey || $d(e) || e === ",") return this.flowKey = !1, yield* this.pushCount(1), yield* this.pushSpaces(!0), "flow";
			}
			default: return this.flowKey = !1, yield* this.parsePlainScalar();
		}
	}
	*parseQuotedScalar() {
		let e = this.charAt(0), t = this.buffer.indexOf(e, this.pos + 1);
		if (e === "'") for (; t !== -1 && this.buffer[t + 1] === "'";) t = this.buffer.indexOf("'", t + 2);
		else for (; t !== -1;) {
			let e = 0;
			for (; this.buffer[t - 1 - e] === "\\";) e += 1;
			if (e % 2 == 0) break;
			t = this.buffer.indexOf("\"", t + 1);
		}
		let n = this.buffer.substring(0, t), r = n.indexOf("\n", this.pos);
		if (r !== -1) {
			for (; r !== -1;) {
				let e = this.continueScalar(r + 1);
				if (e === -1) break;
				r = n.indexOf("\n", e);
			}
			r !== -1 && (t = r - (n[r - 1] === "\r" ? 2 : 1));
		}
		if (t === -1) {
			if (!this.atEnd) return this.setNext("quoted-scalar");
			t = this.buffer.length;
		}
		return yield* this.pushToIndex(t + 1, !1), this.flowLevel ? "flow" : "doc";
	}
	*parseBlockScalarHeader() {
		this.blockScalarIndent = -1, this.blockScalarKeep = !1;
		let e = this.pos;
		for (;;) {
			let t = this.buffer[++e];
			if (t === "+") this.blockScalarKeep = !0;
			else if (t > "0" && t <= "9") this.blockScalarIndent = Number(t) - 1;
			else if (t !== "-") break;
		}
		return yield* this.pushUntil((e) => $d(e) || e === "#");
	}
	*parseBlockScalar() {
		let e = this.pos - 1, t = 0, n;
		loop: for (let r = this.pos; n = this.buffer[r]; ++r) switch (n) {
			case " ":
				t += 1;
				break;
			case "\n":
				e = r, t = 0;
				break;
			case "\r": {
				let e = this.buffer[r + 1];
				if (!e && !this.atEnd) return this.setNext("block-scalar");
				if (e === "\n") break;
			}
			default: break loop;
		}
		if (!n && !this.atEnd) return this.setNext("block-scalar");
		if (t >= this.indentNext) {
			this.indentNext = this.blockScalarIndent === -1 ? t : this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
			do {
				let t = this.continueScalar(e + 1);
				if (t === -1) break;
				e = this.buffer.indexOf("\n", t);
			} while (e !== -1);
			if (e === -1) {
				if (!this.atEnd) return this.setNext("block-scalar");
				e = this.buffer.length;
			}
		}
		let r = e + 1;
		for (n = this.buffer[r]; n === " ";) n = this.buffer[++r];
		if (n === "	") {
			for (; n === "	" || n === " " || n === "\r" || n === "\n";) n = this.buffer[++r];
			e = r - 1;
		} else if (!this.blockScalarKeep) do {
			let n = e - 1, r = this.buffer[n];
			r === "\r" && (r = this.buffer[--n]);
			let i = n;
			for (; r === " ";) r = this.buffer[--n];
			if (r === "\n" && n >= this.pos && n + 1 + t > i) e = n;
			else break;
		} while (1);
		return yield "", yield* this.pushToIndex(e + 1, !0), yield* this.parseLineStart();
	}
	*parsePlainScalar() {
		let e = this.flowLevel > 0, t = this.pos - 1, n = this.pos - 1, r;
		for (; r = this.buffer[++n];) if (r === ":") {
			let r = this.buffer[n + 1];
			if ($d(r) || e && nf.has(r)) break;
			t = n;
		} else if ($d(r)) {
			let i = this.buffer[n + 1];
			if (r === "\r" && (i === "\n" ? (n += 1, r = "\n", i = this.buffer[n + 1]) : t = n), i === "#" || e && nf.has(i)) break;
			if (r === "\n") {
				let e = this.continueScalar(n + 1);
				if (e === -1) break;
				n = Math.max(n, e - 2);
			}
		} else {
			if (e && nf.has(r)) break;
			t = n;
		}
		return !r && !this.atEnd ? this.setNext("plain-scalar") : (yield "", yield* this.pushToIndex(t + 1, !0), e ? "flow" : "doc");
	}
	*pushCount(e) {
		return e > 0 ? (yield this.buffer.substr(this.pos, e), this.pos += e, e) : 0;
	}
	*pushToIndex(e, t) {
		let n = this.buffer.slice(this.pos, e);
		return n ? (yield n, this.pos += n.length, n.length) : (t && (yield ""), 0);
	}
	*pushIndicators() {
		let e = 0;
		loop: for (;;) {
			switch (this.charAt(0)) {
				case "!":
					e += yield* this.pushTag(), e += yield* this.pushSpaces(!0);
					continue loop;
				case "&":
					e += yield* this.pushUntil(af), e += yield* this.pushSpaces(!0);
					continue loop;
				case "-":
				case "?":
				case ":": {
					let t = this.flowLevel > 0, n = this.charAt(1);
					if ($d(n) || t && nf.has(n)) {
						t ? this.flowKey &&= !1 : this.indentNext = this.indentValue + 1, e += yield* this.pushCount(1), e += yield* this.pushSpaces(!0);
						continue loop;
					}
				}
			}
			break loop;
		}
		return e;
	}
	*pushTag() {
		if (this.charAt(1) === "<") {
			let e = this.pos + 2, t = this.buffer[e];
			for (; !$d(t) && t !== ">";) t = this.buffer[++e];
			return yield* this.pushToIndex(t === ">" ? e + 1 : e, !1);
		}
		{
			let e = this.pos + 1, t = this.buffer[e];
			for (; t;) if (tf.has(t)) t = this.buffer[++e];
			else if (t === "%" && ef.has(this.buffer[e + 1]) && ef.has(this.buffer[e + 2])) t = this.buffer[e += 3];
			else break;
			return yield* this.pushToIndex(e, !1);
		}
	}
	*pushNewline() {
		let e = this.buffer[this.pos];
		return e === "\n" ? yield* this.pushCount(1) : e === "\r" && this.charAt(1) === "\n" ? yield* this.pushCount(2) : 0;
	}
	*pushSpaces(e) {
		let t = this.pos - 1, n;
		do
			n = this.buffer[++t];
		while (n === " " || e && n === "	");
		let r = t - this.pos;
		return r > 0 && (yield this.buffer.substr(this.pos, r), this.pos = t), r;
	}
	*pushUntil(e) {
		let t = this.pos, n = this.buffer[t];
		for (; !e(n);) n = this.buffer[++t];
		return yield* this.pushToIndex(t, !1);
	}
}, sf = class {
	constructor() {
		this.lineStarts = [], this.addNewLine = (e) => this.lineStarts.push(e), this.linePos = (e) => {
			let t = 0, n = this.lineStarts.length;
			for (; t < n;) {
				let r = t + n >> 1;
				this.lineStarts[r] < e ? t = r + 1 : n = r;
			}
			if (this.lineStarts[t] === e) return {
				line: t + 1,
				col: 1
			};
			if (t === 0) return {
				line: 0,
				col: e
			};
			let r = this.lineStarts[t - 1];
			return {
				line: t,
				col: e - r + 1
			};
		};
	}
};
// node_modules/yaml/browser/dist/parse/parser.js
function cf(e, t) {
	for (let n = 0; n < e.length; ++n) if (e[n].type === t) return !0;
	return !1;
}
function lf(e) {
	for (let t = 0; t < e.length; ++t) switch (e[t].type) {
		case "space":
		case "comment":
		case "newline": break;
		default: return t;
	}
	return -1;
}
function uf(e) {
	switch (e?.type) {
		case "alias":
		case "scalar":
		case "single-quoted-scalar":
		case "double-quoted-scalar":
		case "flow-collection": return !0;
		default: return !1;
	}
}
function df(e) {
	switch (e.type) {
		case "document": return e.start;
		case "block-map": {
			let t = e.items[e.items.length - 1];
			return t.sep ?? t.start;
		}
		case "block-seq": return e.items[e.items.length - 1].start;
		/* istanbul ignore next should not happen */
		default: return [];
	}
}
function ff(e) {
	if (e.length === 0) return [];
	let t = e.length;
	loop: for (; --t >= 0;) switch (e[t].type) {
		case "doc-start":
		case "explicit-key-ind":
		case "map-value-ind":
		case "seq-item-ind":
		case "newline": break loop;
	}
	for (; e[++t]?.type === "space";);
	return e.splice(t, e.length);
}
function pf(e, t) {
	if (t.length < 1e5) Array.prototype.push.apply(e, t);
	else for (let n = 0; n < t.length; ++n) e.push(t[n]);
}
function mf(e) {
	if (e.start.type === "flow-seq-start") for (let t of e.items) t.sep && !t.value && !cf(t.start, "explicit-key-ind") && !cf(t.sep, "map-value-ind") && (t.key && (t.value = t.key), delete t.key, uf(t.value) ? t.value.end ? pf(t.value.end, t.sep) : t.value.end = t.sep : pf(t.start, t.sep), delete t.sep);
}
var hf = class {
	constructor(e) {
		this.atNewLine = !0, this.atScalar = !1, this.indent = 0, this.offset = 0, this.onKeyLine = !1, this.stack = [], this.source = "", this.type = "", this.lexer = new of(), this.onNewLine = e;
	}
	*parse(e, t = !1) {
		this.onNewLine && this.offset === 0 && this.onNewLine(0);
		for (let n of this.lexer.lex(e, t)) yield* this.next(n);
		t || (yield* this.end());
	}
	*next(e) {
		if (this.source = e, this.atScalar) {
			this.atScalar = !1, yield* this.step(), this.offset += e.length;
			return;
		}
		let t = Qd(e);
		if (!t) {
			let t = `Not a YAML token: ${e}`;
			yield* this.pop({
				type: "error",
				offset: this.offset,
				message: t,
				source: e
			}), this.offset += e.length;
		} else if (t === "scalar") this.atNewLine = !1, this.atScalar = !0, this.type = "scalar";
		else {
			switch (this.type = t, yield* this.step(), t) {
				case "newline":
					this.atNewLine = !0, this.indent = 0, this.onNewLine && this.onNewLine(this.offset + e.length);
					break;
				case "space":
					this.atNewLine && e[0] === " " && (this.indent += e.length);
					break;
				case "explicit-key-ind":
				case "map-value-ind":
				case "seq-item-ind":
					this.atNewLine && (this.indent += e.length);
					break;
				case "doc-mode":
				case "flow-error-end": return;
				default: this.atNewLine = !1;
			}
			this.offset += e.length;
		}
	}
	*end() {
		for (; this.stack.length > 0;) yield* this.pop();
	}
	get sourceToken() {
		return {
			type: this.type,
			offset: this.offset,
			indent: this.indent,
			source: this.source
		};
	}
	*step() {
		let e = this.peek(1);
		if (this.type === "doc-end" && e?.type !== "doc-end") {
			for (; this.stack.length > 0;) yield* this.pop();
			this.stack.push({
				type: "doc-end",
				offset: this.offset,
				source: this.source
			});
		} else {
			if (!e) return yield* this.stream();
			switch (e.type) {
				case "document": return yield* this.document(e);
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return yield* this.scalar(e);
				case "block-scalar": return yield* this.blockScalar(e);
				case "block-map": return yield* this.blockMap(e);
				case "block-seq": return yield* this.blockSequence(e);
				case "flow-collection": return yield* this.flowCollection(e);
				case "doc-end": return yield* this.documentEnd(e);
			}
			/* istanbul ignore next should not happen */
			yield* this.pop();
		}
	}
	peek(e) {
		return this.stack[this.stack.length - e];
	}
	*pop(e) {
		let t = e ?? this.stack.pop();
		/* istanbul ignore if should not happen */
		if (!t) yield {
			type: "error",
			offset: this.offset,
			source: "",
			message: "Tried to pop an empty stack"
		};
		else if (this.stack.length === 0) yield t;
		else {
			let e = this.peek(1);
			switch (t.type === "block-scalar" ? t.indent = "indent" in e ? e.indent : 0 : t.type === "flow-collection" && e.type === "document" && (t.indent = 0), t.type === "flow-collection" && mf(t), e.type) {
				case "document":
					e.value = t;
					break;
				case "block-scalar":
					e.props.push(t);
					break;
				case "block-map": {
					let n = e.items[e.items.length - 1];
					if (n.value) {
						e.items.push({
							start: [],
							key: t,
							sep: []
						}), this.onKeyLine = !0;
						return;
					}
					if (n.sep) n.value = t;
					else {
						Object.assign(n, {
							key: t,
							sep: []
						}), this.onKeyLine = !n.explicitKey;
						return;
					}
					break;
				}
				case "block-seq": {
					let n = e.items[e.items.length - 1];
					n.value ? e.items.push({
						start: [],
						value: t
					}) : n.value = t;
					break;
				}
				case "flow-collection": {
					let n = e.items[e.items.length - 1];
					!n || n.value ? e.items.push({
						start: [],
						key: t,
						sep: []
					}) : n.sep ? n.value = t : Object.assign(n, {
						key: t,
						sep: []
					});
					return;
				}
				/* istanbul ignore next should not happen */
				default: yield* this.pop(), yield* this.pop(t);
			}
			if ((e.type === "document" || e.type === "block-map" || e.type === "block-seq") && (t.type === "block-map" || t.type === "block-seq")) {
				let n = t.items[t.items.length - 1];
				n && !n.sep && !n.value && n.start.length > 0 && lf(n.start) === -1 && (t.indent === 0 || n.start.every((e) => e.type !== "comment" || e.indent < t.indent)) && (e.type === "document" ? e.end = n.start : e.items.push({ start: n.start }), t.items.splice(-1, 1));
			}
		}
	}
	*stream() {
		switch (this.type) {
			case "directive-line":
				yield {
					type: "directive",
					offset: this.offset,
					source: this.source
				};
				return;
			case "byte-order-mark":
			case "space":
			case "comment":
			case "newline":
				yield this.sourceToken;
				return;
			case "doc-mode":
			case "doc-start": {
				let e = {
					type: "document",
					offset: this.offset,
					start: []
				};
				this.type === "doc-start" && e.start.push(this.sourceToken), this.stack.push(e);
				return;
			}
		}
		yield {
			type: "error",
			offset: this.offset,
			message: `Unexpected ${this.type} token in YAML stream`,
			source: this.source
		};
	}
	*document(e) {
		if (e.value) return yield* this.lineEnd(e);
		switch (this.type) {
			case "doc-start":
				lf(e.start) === -1 ? e.start.push(this.sourceToken) : (yield* this.pop(), yield* this.step());
				return;
			case "anchor":
			case "tag":
			case "space":
			case "comment":
			case "newline":
				e.start.push(this.sourceToken);
				return;
		}
		let t = this.startBlockValue(e);
		t ? this.stack.push(t) : yield {
			type: "error",
			offset: this.offset,
			message: `Unexpected ${this.type} token in YAML document`,
			source: this.source
		};
	}
	*scalar(e) {
		if (this.type === "map-value-ind") {
			let t = ff(df(this.peek(2))), n;
			e.end ? (n = e.end, n.push(this.sourceToken), delete e.end) : n = [this.sourceToken];
			let r = {
				type: "block-map",
				offset: e.offset,
				indent: e.indent,
				items: [{
					start: t,
					key: e,
					sep: n
				}]
			};
			this.onKeyLine = !0, this.stack[this.stack.length - 1] = r;
		} else yield* this.lineEnd(e);
	}
	*blockScalar(e) {
		switch (this.type) {
			case "space":
			case "comment":
			case "newline":
				e.props.push(this.sourceToken);
				return;
			case "scalar":
				if (e.source = this.source, this.atNewLine = !0, this.indent = 0, this.onNewLine) {
					let e = this.source.indexOf("\n") + 1;
					for (; e !== 0;) this.onNewLine(this.offset + e), e = this.source.indexOf("\n", e) + 1;
				}
				yield* this.pop();
				break;
			/* istanbul ignore next should not happen */
			default: yield* this.pop(), yield* this.step();
		}
	}
	*blockMap(e) {
		let t = e.items[e.items.length - 1];
		switch (this.type) {
			case "newline":
				if (this.onKeyLine = !1, t.value) {
					let n = "end" in t.value ? t.value.end : void 0;
					(Array.isArray(n) ? n[n.length - 1] : void 0)?.type === "comment" ? n?.push(this.sourceToken) : e.items.push({ start: [this.sourceToken] });
				} else t.sep ? t.sep.push(this.sourceToken) : t.start.push(this.sourceToken);
				return;
			case "space":
			case "comment":
				if (t.value) e.items.push({ start: [this.sourceToken] });
				else if (t.sep) t.sep.push(this.sourceToken);
				else {
					if (this.atIndentedComment(t.start, e.indent)) {
						let n = e.items[e.items.length - 2]?.value?.end;
						if (Array.isArray(n)) {
							pf(n, t.start), n.push(this.sourceToken), e.items.pop();
							return;
						}
					}
					t.start.push(this.sourceToken);
				}
				return;
		}
		if (this.indent >= e.indent) {
			let n = !this.onKeyLine && this.indent === e.indent, r = n && (t.sep || t.explicitKey) && this.type !== "seq-item-ind", i = [];
			if (r && t.sep && !t.value) {
				let n = [];
				for (let r = 0; r < t.sep.length; ++r) {
					let i = t.sep[r];
					switch (i.type) {
						case "newline":
							n.push(r);
							break;
						case "space": break;
						case "comment":
							i.indent > e.indent && (n.length = 0);
							break;
						default: n.length = 0;
					}
				}
				n.length >= 2 && (i = t.sep.splice(n[1]));
			}
			switch (this.type) {
				case "anchor":
				case "tag":
					r || t.value ? (i.push(this.sourceToken), e.items.push({ start: i }), this.onKeyLine = !0) : t.sep ? t.sep.push(this.sourceToken) : t.start.push(this.sourceToken);
					return;
				case "explicit-key-ind":
					!t.sep && !t.explicitKey ? (t.start.push(this.sourceToken), t.explicitKey = !0) : r || t.value ? (i.push(this.sourceToken), e.items.push({
						start: i,
						explicitKey: !0
					})) : this.stack.push({
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start: [this.sourceToken],
							explicitKey: !0
						}]
					}), this.onKeyLine = !0;
					return;
				case "map-value-ind":
					if (t.explicitKey) {
						if (!t.sep) {
							if (cf(t.start, "newline")) Object.assign(t, {
								key: null,
								sep: [this.sourceToken]
							});
							else {
								let e = ff(t.start);
								this.stack.push({
									type: "block-map",
									offset: this.offset,
									indent: this.indent,
									items: [{
										start: e,
										key: null,
										sep: [this.sourceToken]
									}]
								});
							}
						} else if (t.value) e.items.push({
							start: [],
							key: null,
							sep: [this.sourceToken]
						});
						else if (cf(t.sep, "map-value-ind")) this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: i,
								key: null,
								sep: [this.sourceToken]
							}]
						});
						else if (uf(t.key) && !cf(t.sep, "newline")) {
							let e = ff(t.start), n = t.key, r = t.sep;
							r.push(this.sourceToken), delete t.key, delete t.sep, this.stack.push({
								type: "block-map",
								offset: this.offset,
								indent: this.indent,
								items: [{
									start: e,
									key: n,
									sep: r
								}]
							});
						} else i.length > 0 ? t.sep = t.sep.concat(i, this.sourceToken) : t.sep.push(this.sourceToken);
					} else t.sep ? t.value || r ? e.items.push({
						start: i,
						key: null,
						sep: [this.sourceToken]
					}) : cf(t.sep, "map-value-ind") ? this.stack.push({
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start: [],
							key: null,
							sep: [this.sourceToken]
						}]
					}) : t.sep.push(this.sourceToken) : Object.assign(t, {
						key: null,
						sep: [this.sourceToken]
					});
					this.onKeyLine = !0;
					return;
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": {
					let n = this.flowScalar(this.type);
					r || t.value ? (e.items.push({
						start: i,
						key: n,
						sep: []
					}), this.onKeyLine = !0) : t.sep ? this.stack.push(n) : (Object.assign(t, {
						key: n,
						sep: []
					}), this.onKeyLine = !0);
					return;
				}
				default: {
					let r = this.startBlockValue(e);
					if (r) {
						if (r.type === "block-seq") {
							if (!t.explicitKey && t.sep && !cf(t.sep, "newline")) {
								yield* this.pop({
									type: "error",
									offset: this.offset,
									message: "Unexpected block-seq-ind on same line with key",
									source: this.source
								});
								return;
							}
						} else n && e.items.push({ start: i });
						this.stack.push(r);
						return;
					}
				}
			}
		}
		yield* this.pop(), yield* this.step();
	}
	*blockSequence(e) {
		let t = e.items[e.items.length - 1];
		switch (this.type) {
			case "newline":
				if (t.value) {
					let n = "end" in t.value ? t.value.end : void 0;
					(Array.isArray(n) ? n[n.length - 1] : void 0)?.type === "comment" ? n?.push(this.sourceToken) : e.items.push({ start: [this.sourceToken] });
				} else t.start.push(this.sourceToken);
				return;
			case "space":
			case "comment":
				if (t.value) e.items.push({ start: [this.sourceToken] });
				else {
					if (this.atIndentedComment(t.start, e.indent)) {
						let n = e.items[e.items.length - 2]?.value?.end;
						if (Array.isArray(n)) {
							pf(n, t.start), n.push(this.sourceToken), e.items.pop();
							return;
						}
					}
					t.start.push(this.sourceToken);
				}
				return;
			case "anchor":
			case "tag":
				if (t.value || this.indent <= e.indent) break;
				t.start.push(this.sourceToken);
				return;
			case "seq-item-ind":
				if (this.indent !== e.indent) break;
				t.value || cf(t.start, "seq-item-ind") ? e.items.push({ start: [this.sourceToken] }) : t.start.push(this.sourceToken);
				return;
		}
		if (this.indent > e.indent) {
			let t = this.startBlockValue(e);
			if (t) {
				this.stack.push(t);
				return;
			}
		}
		yield* this.pop(), yield* this.step();
	}
	*flowCollection(e) {
		let t = e.items[e.items.length - 1];
		if (this.type === "flow-error-end") {
			let e;
			do
				yield* this.pop(), e = this.peek(1);
			while (e?.type === "flow-collection");
		} else if (e.end.length === 0) {
			switch (this.type) {
				case "comma":
				case "explicit-key-ind":
					!t || t.sep ? e.items.push({ start: [this.sourceToken] }) : t.start.push(this.sourceToken);
					return;
				case "map-value-ind":
					!t || t.value ? e.items.push({
						start: [],
						key: null,
						sep: [this.sourceToken]
					}) : t.sep ? t.sep.push(this.sourceToken) : Object.assign(t, {
						key: null,
						sep: [this.sourceToken]
					});
					return;
				case "space":
				case "comment":
				case "newline":
				case "anchor":
				case "tag":
					!t || t.value ? e.items.push({ start: [this.sourceToken] }) : t.sep ? t.sep.push(this.sourceToken) : t.start.push(this.sourceToken);
					return;
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": {
					let n = this.flowScalar(this.type);
					!t || t.value ? e.items.push({
						start: [],
						key: n,
						sep: []
					}) : t.sep ? this.stack.push(n) : Object.assign(t, {
						key: n,
						sep: []
					});
					return;
				}
				case "flow-map-end":
				case "flow-seq-end":
					e.end.push(this.sourceToken);
					return;
			}
			let n = this.startBlockValue(e);
			/* istanbul ignore else should not happen */
			n ? this.stack.push(n) : (yield* this.pop(), yield* this.step());
		} else {
			let t = this.peek(2);
			if (t.type === "block-map" && (this.type === "map-value-ind" && t.indent === e.indent || this.type === "newline" && !t.items[t.items.length - 1].sep)) yield* this.pop(), yield* this.step();
			else if (this.type === "map-value-ind" && t.type !== "flow-collection") {
				let n = ff(df(t));
				mf(e);
				let r = e.end.splice(1, e.end.length);
				r.push(this.sourceToken);
				let i = {
					type: "block-map",
					offset: e.offset,
					indent: e.indent,
					items: [{
						start: n,
						key: e,
						sep: r
					}]
				};
				this.onKeyLine = !0, this.stack[this.stack.length - 1] = i;
			} else yield* this.lineEnd(e);
		}
	}
	flowScalar(e) {
		if (this.onNewLine) {
			let e = this.source.indexOf("\n") + 1;
			for (; e !== 0;) this.onNewLine(this.offset + e), e = this.source.indexOf("\n", e) + 1;
		}
		return {
			type: e,
			offset: this.offset,
			indent: this.indent,
			source: this.source
		};
	}
	startBlockValue(e) {
		switch (this.type) {
			case "alias":
			case "scalar":
			case "single-quoted-scalar":
			case "double-quoted-scalar": return this.flowScalar(this.type);
			case "block-scalar-header": return {
				type: "block-scalar",
				offset: this.offset,
				indent: this.indent,
				props: [this.sourceToken],
				source: ""
			};
			case "flow-map-start":
			case "flow-seq-start": return {
				type: "flow-collection",
				offset: this.offset,
				indent: this.indent,
				start: this.sourceToken,
				items: [],
				end: []
			};
			case "seq-item-ind": return {
				type: "block-seq",
				offset: this.offset,
				indent: this.indent,
				items: [{ start: [this.sourceToken] }]
			};
			case "explicit-key-ind": {
				this.onKeyLine = !0;
				let t = ff(df(e));
				return t.push(this.sourceToken), {
					type: "block-map",
					offset: this.offset,
					indent: this.indent,
					items: [{
						start: t,
						explicitKey: !0
					}]
				};
			}
			case "map-value-ind": {
				this.onKeyLine = !0;
				let t = ff(df(e));
				return {
					type: "block-map",
					offset: this.offset,
					indent: this.indent,
					items: [{
						start: t,
						key: null,
						sep: [this.sourceToken]
					}]
				};
			}
		}
		return null;
	}
	atIndentedComment(e, t) {
		return this.type !== "comment" || this.indent <= t ? !1 : e.every((e) => e.type === "newline" || e.type === "space");
	}
	*documentEnd(e) {
		this.type !== "doc-mode" && (e.end ? e.end.push(this.sourceToken) : e.end = [this.sourceToken], this.type === "newline" && (yield* this.pop()));
	}
	*lineEnd(e) {
		switch (this.type) {
			case "comma":
			case "doc-start":
			case "doc-end":
			case "flow-seq-end":
			case "flow-map-end":
			case "map-value-ind":
				yield* this.pop(), yield* this.step();
				break;
			case "newline": this.onKeyLine = !1;
			default: e.end ? e.end.push(this.sourceToken) : e.end = [this.sourceToken], this.type === "newline" && (yield* this.pop());
		}
	}
};
// node_modules/yaml/browser/dist/public-api.js
function gf(e) {
	let t = e.prettyErrors !== !1;
	return {
		lineCounter: e.lineCounter || t && new sf() || null,
		prettyErrors: t
	};
}
function _f(e, t = {}) {
	let { lineCounter: n, prettyErrors: r } = gf(t), i = new hf(n?.addNewLine), a = new Kd(t), o = null;
	for (let t of a.compose(i.parse(e), !0, e.length)) if (!o) o = t;
	else if (o.options.logLevel !== "silent") {
		o.errors.push(new cd(t.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
		break;
	}
	return r && n && (o.errors.forEach(ud(e, n)), o.warnings.forEach(ud(e, n))), o;
}
function vf(e, t, n) {
	let r;
	typeof t == "function" ? r = t : n === void 0 && t && typeof t == "object" && (n = t);
	let i = _f(e, n);
	if (!i) return null;
	if (i.warnings.forEach((e) => Vl(i.options.logLevel, e)), i.errors.length > 0) {
		if (i.options.logLevel !== "silent") throw i.errors[0];
		i.errors = [];
	}
	return i.toJS(Object.assign({ reviver: r }, n));
}
// src/server/catalog/frontmatter.ts
var yf = {
	UNTERMINATED: "FRONTMATTER_UNTERMINATED",
	INVALID_YAML: "FRONTMATTER_INVALID_YAML",
	NOT_A_MAPPING: "FRONTMATTER_NOT_A_MAPPING"
}, bf = class extends Error {
	code;
	constructor(e, t, n = {}) {
		super(t, n.cause === void 0 ? void 0 : { cause: n.cause }), this.name = new.target.name, this.code = e;
	}
}, xf = /^---[ \t]*(\r?\n|$)/, Sf = /^---[ \t]*$/m;
function Cf(e) {
	let t = Tf(e), n = xf.exec(t);
	if (!n) return {
		present: !1,
		data: {},
		body: t
	};
	let r = t.slice(n[0].length), i = Sf.exec(r);
	if (!i) throw new bf(yf.UNTERMINATED, "The SKILL.md frontmatter is missing its closing \"---\" delimiter.");
	let a = r.slice(0, i.index), o = r.slice(i.index + i[0].length).replace(/^\r?\n/, "");
	if (a.trim() === "") return {
		present: !0,
		data: {},
		body: o
	};
	let s;
	try {
		s = vf(a);
	} catch (e) {
		throw new bf(yf.INVALID_YAML, "The SKILL.md frontmatter is not valid YAML.", { cause: e });
	}
	if (s == null) return {
		present: !0,
		data: {},
		body: o
	};
	if (!Ef(s)) throw new bf(yf.NOT_A_MAPPING, "The SKILL.md frontmatter must be a YAML mapping.");
	return {
		present: !0,
		data: s,
		body: o
	};
}
function wf(e, t) {
	if (!Object.hasOwn(e, t)) return;
	let n = e[t];
	if (typeof n != "string") return;
	let r = n.trim();
	return r === "" ? void 0 : r;
}
function Tf(e) {
	return e.charCodeAt(0) === 65279 ? e.slice(1) : e;
}
function Ef(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
// src/shared/chain.ts
function Df(e) {
	return e.label?.trim() || (e.kind === "instruction" ? "Instruction" : e.skillName);
}
var Of = ["opencode", "copilot"], kf = L(Of), K = N().trim().min(1), Af = I({
	opencode: K.optional(),
	copilot: K.optional()
}), jf = I({
	id: K,
	canonicalPath: K,
	displayName: K,
	lastOpenedAt: Nc({ offset: !0 }),
	managedWorkspace: R(!0).optional()
}), Mf = I({
	version: R(1),
	projectDevice: N().regex(/^[0-9]+$/),
	projectInode: N().regex(/^[0-9]+$/)
}), Nf = I({
	id: ws(),
	projectId: K,
	sourceProjectId: K.optional(),
	sourceChainId: K.optional(),
	sourceDraftId: K.optional(),
	chainId: K,
	createdAt: Nc({ offset: !0 }),
	retirement: Mf.optional()
}).superRefine((e, t) => {
	(e.sourceProjectId !== void 0 && e.sourceChainId !== void 0) == (e.sourceDraftId !== void 0) && t.addIssue({
		code: "custom",
		message: "A test workspace must have exactly one valid source chain or draft."
	}), e.sourceProjectId === void 0 != (e.sourceChainId === void 0) && t.addIssue({
		code: "custom",
		message: "A project source requires both project and chain ids."
	});
}), Pf = I({
	id: ws(),
	projectId: K,
	chainId: K,
	harness: kf,
	createdAt: Nc({ offset: !0 }),
	handoffFingerprint: N().regex(/^[a-f0-9]{64}$/),
	autoImport: Ks(),
	runId: K.optional(),
	resultFingerprint: N().regex(/^[a-f0-9]{64}$/).optional(),
	importedDraftId: K.optional(),
	retirement: Mf.optional()
}), Ff = N().trim().min(1).max(2048).refine((e) => {
	if (/^git@[^/:\\\s]+:[^\\\s?#]+(?:\.git)?$/i.test(e)) return !0;
	let t;
	try {
		t = new URL(e);
	} catch {
		return !1;
	}
	return (t.protocol === "https:" || t.protocol === "ssh:") && (t.username === "" || t.protocol === "ssh:" && t.username === "git") && t.password === "" && t.search === "" && t.hash === "" && t.hostname !== "";
}, "Use an HTTPS or SSH Git remote without embedded credentials or query parameters."), If = N().trim().min(1).max(255).refine((e) => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(e) && !e.includes("..") && !e.includes("//") && !e.includes("@{") && !e.endsWith("/") && !e.endsWith(".") && !e.split("/").some((e) => e.endsWith(".lock")), "Use a branch, tag, or full commit hash."), Lf = {
	maxPackages: 100,
	maxAgents: 100,
	maxFiles: 2e3,
	maxPackageBytes: 20971520,
	maxSnapshotBytes: 20971520,
	maxStagingBytes: 134217728,
	maxStagingEntries: 1e4,
	maxCommandOutputBytes: 2097152,
	cloneTimeoutMs: 12e4,
	commandTimeoutMs: 15e3
}, Rf = {
	maxPackages: 1e4,
	maxAgents: 1e4,
	maxFiles: 2e5,
	maxPackageBytes: 268435456,
	maxSnapshotBytes: 1073741824,
	maxStagingBytes: 4294967296,
	maxStagingEntries: 5e5,
	maxCommandOutputBytes: 67108864,
	cloneTimeoutMs: 18e5,
	commandTimeoutMs: 18e5
}, zf = (e) => Hs().int().min(1).max(e), Bf = {
	maxPackages: zf(Rf.maxPackages),
	maxAgents: zf(Rf.maxAgents),
	maxFiles: zf(Rf.maxFiles),
	maxPackageBytes: zf(Rf.maxPackageBytes),
	maxSnapshotBytes: zf(Rf.maxSnapshotBytes),
	maxStagingBytes: zf(Rf.maxStagingBytes),
	maxStagingEntries: zf(Rf.maxStagingEntries),
	maxCommandOutputBytes: zf(Rf.maxCommandOutputBytes),
	cloneTimeoutMs: zf(Rf.cloneTimeoutMs),
	commandTimeoutMs: zf(Rf.commandTimeoutMs)
}, Vf = I(Bf).partial(), Hf = I(Bf), Uf = I({
	id: N().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	repository: Ff,
	ref: If.optional()
}), Wf = Uf.extend({ limits: Vf.optional() }), Gf = oc(N(), Js()), Kf = {
	harnessCommands: Af.default({}),
	extraSkillDirectories: F(K).default([]),
	sharedBundleDirectory: K.optional(),
	recentProjects: F(jf).default([]),
	testWorkspaces: F(Nf).default([]),
	discoveryWorkspaces: F(Pf).default([]),
	uiPreferences: Gf.default({})
};
I({
	version: R(1),
	...Kf,
	remoteSkillSources: F(Uf).default([])
}), I({
	version: R(2),
	harnessCommands: Kf.harnessCommands,
	extraSkillDirectories: Kf.extraSkillDirectories,
	remoteSkillSources: F(Wf).default([]),
	remoteCatalogLimits: Hf.default(Lf),
	sharedBundleDirectory: Kf.sharedBundleDirectory,
	recentProjects: Kf.recentProjects,
	testWorkspaces: Kf.testWorkspaces,
	discoveryWorkspaces: Kf.discoveryWorkspaces,
	uiPreferences: Kf.uiPreferences
}), I({
	harnessCommands: Af.optional(),
	extraSkillDirectories: F(K).optional(),
	remoteSkillSources: F(Wf).optional(),
	remoteCatalogLimits: Vf.optional(),
	sharedBundleDirectory: K.nullable().optional(),
	recentProjects: F(jf).optional(),
	testWorkspaces: F(Nf).optional(),
	discoveryWorkspaces: F(Pf).optional(),
	uiPreferences: Gf.optional()
});
var qf = L([
	"shared",
	"fresh",
	"fork"
]), Jf = /^[A-Za-z][A-Za-z0-9_]*$/, Yf = N().trim().min(1), Xf = Nc({ offset: !0 }), Zf = I({
	harness: kf,
	name: Yf,
	sourceId: N().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	revision: N().regex(/^[a-f0-9]{40,64}$/),
	repositoryPath: Yf.max(4096),
	agentPath: Yf.max(4096),
	fingerprint: N().regex(/^[a-f0-9]{64}$/)
}), Qf = I({
	sourceId: N().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	revision: N().regex(/^[a-f0-9]{40,64}$/),
	repositoryPath: Yf.max(4096)
}), $f = {
	id: Yf,
	instruction: Yf,
	label: Yf.optional()
}, ep = nc("kind", [I({
	...$f,
	kind: R("skill").optional(),
	skillName: Yf,
	skillBinding: Qf.optional()
}), I({
	...$f,
	kind: R("instruction"),
	skillName: Xs().optional()
})]), tp = I({
	name: N().regex(Jf),
	label: Yf.optional(),
	required: Ks().default(!1),
	defaultValue: N().optional()
}), np = {
	id: Yf,
	name: Yf,
	harness: kf,
	sessionMode: qf,
	steps: F(ep).min(1),
	inputs: F(tp).default([]),
	automaticPermissionOptIn: Ks().default(!1),
	createdAt: Xf,
	updatedAt: Xf
}, rp = nc("kind", [I({
	...$f,
	kind: R("skill").optional(),
	skillName: Yf
}), I({
	...$f,
	kind: R("instruction"),
	skillName: Xs().optional()
})]), ip = {
	...np,
	steps: F(rp).min(1)
}, ap = I({
	version: R(1),
	...ip
}), op = I({
	version: R(2),
	...ip,
	agent: Zf.optional()
}), q = I({
	version: R(3),
	...np,
	agent: Zf.optional()
}), sp = {
	DUPLICATE_STEP_ID: "chain_duplicate_step_id",
	DUPLICATE_INPUT_NAME: "chain_duplicate_input_name",
	PLACEHOLDER_INVALID: "chain_placeholder_invalid",
	PLACEHOLDER_UNKNOWN: "chain_placeholder_unknown",
	AGENT_HARNESS_MISMATCH: "chain_agent_harness_mismatch",
	SKILL_BINDING_CONFLICT: "chain_skill_binding_conflict"
}, cp = { INPUT_UNUSED: "chain_input_unused" }, lp = class extends Error {
	code;
	details;
	constructor(e, t, n = {}, r = {}) {
		super(t, r.cause === void 0 ? void 0 : { cause: r.cause }), this.name = new.target.name, this.code = e, this.details = n;
	}
}, up = class extends lp {
	issues;
	constructor(e) {
		super("CHAIN_INVALID", "The chain is not valid.", { issues: e }), this.issues = e;
	}
};
function dp(e) {
	if (!xp(e)) return e;
	if (!Object.hasOwn(e, "version")) return {
		...e,
		version: 3
	};
	if (e.version === 1 || e.version === 2) {
		let t = (e.version === 1 ? ap : op).safeParse(e);
		return t.success ? {
			...t.data,
			version: 3
		} : e;
	}
	return e;
}
function fp(e) {
	let t = q.safeParse(e);
	if (!t.success) throw new up(bp(t.error.issues));
	let n = t.data, r = [];
	if (n.agent !== void 0 && n.agent.harness !== n.harness && r.push({
		path: "agent.harness",
		code: sp.AGENT_HARNESS_MISMATCH,
		message: `The selected ${n.agent.harness} agent is incompatible with the ${n.harness} chain harness.`
	}), hp(n, r), gp(n, r), _p(n, r), vp(n, r), r.length > 0) throw new up(r);
	return {
		chain: n,
		warnings: mp(n)
	};
}
function pp(e) {
	return fp(e).chain;
}
function mp(e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e.steps) for (let e of yp(n.instruction)) t.add(e.name);
	let n = [];
	return e.inputs.forEach((e, r) => {
		t.has(e.name) || n.push({
			path: `inputs.${String(r)}.name`,
			code: cp.INPUT_UNUSED,
			message: `Input "${e.name}" is declared but never used in an instruction.`,
			inputName: e.name
		});
	}), n;
}
function hp(e, t) {
	let n = /* @__PURE__ */ new Map();
	e.steps.forEach((e, r) => {
		let i = n.get(e.id);
		i === void 0 ? n.set(e.id, r) : t.push({
			path: `steps.${String(r)}.id`,
			code: sp.DUPLICATE_STEP_ID,
			message: `Step id "${e.id}" is already used by step ${String(i + 1)}.`,
			stepId: e.id,
			stepIndex: r
		});
	});
}
function gp(e, t) {
	let n = /* @__PURE__ */ new Map();
	e.steps.forEach((e, r) => {
		if (e.kind === "instruction") return;
		let i = e.skillName, a = e.skillBinding === void 0 ? null : [
			e.skillBinding.sourceId,
			e.skillBinding.revision,
			e.skillBinding.repositoryPath
		].join("\0"), o = n.get(i);
		o === void 0 ? n.set(i, {
			binding: a,
			stepId: e.id,
			stepIndex: r
		}) : o.binding !== a && t.push({
			path: `steps.${String(r)}.skillBinding`,
			code: sp.SKILL_BINDING_CONFLICT,
			message: `Skill steps named "${e.skillName}" cannot select different packages in one chain.`,
			stepId: e.id,
			stepIndex: r
		});
	});
}
function _p(e, t) {
	let n = /* @__PURE__ */ new Map();
	e.inputs.forEach((e, r) => {
		let i = n.get(e.name);
		i === void 0 ? n.set(e.name, r) : t.push({
			path: `inputs.${String(r)}.name`,
			code: sp.DUPLICATE_INPUT_NAME,
			message: `Input name "${e.name}" is already declared by input ${String(i + 1)}.`,
			inputName: e.name
		});
	});
}
function vp(e, t) {
	let n = new Set(e.inputs.map((e) => e.name));
	e.steps.forEach((e, r) => {
		let i = /* @__PURE__ */ new Set();
		for (let a of yp(e.instruction)) {
			if (i.has(a.name)) continue;
			let o = Df(e);
			a.name === "" || !Jf.test(a.name) ? (i.add(a.name), t.push({
				path: `steps.${String(r)}.instruction`,
				code: sp.PLACEHOLDER_INVALID,
				message: `Step "${o}" contains an invalid placeholder "${a.raw}".`,
				stepId: e.id,
				stepIndex: r,
				inputName: a.name
			})) : n.has(a.name) || (i.add(a.name), t.push({
				path: `steps.${String(r)}.instruction`,
				code: sp.PLACEHOLDER_UNKNOWN,
				message: `Step "${o}" references undeclared input "${a.name}".`,
				stepId: e.id,
				stepIndex: r,
				inputName: a.name
			}));
		}
	});
}
function yp(e) {
	let t = [];
	for (let n of e.matchAll(/\{\{([^{}]*)\}\}/g)) {
		let e = n[1] ?? "";
		t.push({
			raw: e,
			name: e.trim()
		});
	}
	return t;
}
function bp(e) {
	return e.map((e) => ({
		path: e.path.map((e) => String(e)).join("."),
		code: e.code,
		message: e.message
	}));
}
function xp(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
// src/portable/bundle.ts
var Sp = 20971520, Cp = 2e3, wp = 31457280, Tp = class extends Error {
	code;
	constructor(e, t) {
		super(t), this.code = e, this.name = "BundleError";
	}
}, Ep = /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i, Dp = I({
	path: N().min(1).max(512),
	content: N().max(Math.ceil(Sp / 3) * 4),
	executable: Ks()
}), Op = I({
	format: R("skill-loom-chain"),
	version: R(1),
	chain: I({
		name: q.shape.name,
		harness: q.shape.harness,
		sessionMode: q.shape.sessionMode,
		steps: q.shape.steps,
		inputs: q.shape.inputs
	}),
	skills: F(I({
		name: N().trim().min(1).max(128),
		directory: N().min(1).max(128).regex(/^[^/\\]+$/),
		files: F(Dp).min(1).max(Cp)
	})).max(100)
}), kp = I({
	name: N().trim().min(1).max(128),
	harness: q.shape.harness,
	agentPath: N().min(1).max(512),
	fingerprint: N().regex(/^[a-f0-9]{64}$/),
	content: N().max(Math.ceil(Sp / 3) * 4)
}), Ap = I({
	format: R("skill-loom-chain"),
	version: R(2),
	chain: I({
		name: q.shape.name,
		harness: q.shape.harness,
		sessionMode: q.shape.sessionMode,
		steps: q.shape.steps,
		inputs: q.shape.inputs,
		agent: Zf.optional()
	}),
	skills: F(I({
		name: N().trim().min(1).max(128),
		directory: N().min(1).max(128).regex(/^[^/\\]+$/),
		files: F(Dp).min(1).max(Cp)
	})).max(100),
	agents: F(kp).max(1)
});
function J(e) {
	throw new Tp("BUNDLE_INVALID", e);
}
function jp(e) {
	let t = e.split("/");
	(t.length > 32 || t.some((e) => e === "." || e === ".." || !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(e) || /[. ]$/.test(e) || Ep.test(e) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(e))) && J("The bundle contains an unsafe or excluded package path.");
}
function Mp(e) {
	(e.length % 4 != 0 || /[^A-Za-z0-9+/=]/.test(e)) && J("Package file contents must be canonical base64.");
	let t = Buffer.from(e, "base64");
	return t.toString("base64") !== e && J("Package file contents are not canonical base64."), t;
}
function Np(e) {
	return [...new Set(e.steps.flatMap((e) => "skillName" in e && typeof e.skillName == "string" ? [e.skillName] : []))];
}
function Pp(e) {
	let t = e.version === 2 ? e.chain.agent : void 0;
	return pp({
		...e.chain,
		...t === void 0 ? {} : { agent: t },
		version: 3,
		id: "portable-bundle",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		automaticPermissionOptIn: !1
	});
}
function Fp(e) {
	let t = Ip(e) ? e.version : void 0, n = t === 1 ? Op.safeParse(e) : t === 2 ? Ap.safeParse(e) : null;
	n === null && J("The file is not a supported Skill Loom chain bundle."), n.success || J("The file is not a supported Skill Loom chain bundle.");
	let r = n.data, i = Pp(r), a = new Set(Np(i)), o = /* @__PURE__ */ new Set(), s = /* @__PURE__ */ new Set(), c = 0, l = 0;
	for (let e of r.skills) {
		jp(e.directory);
		let t = e.directory.toLowerCase();
		(o.has(e.name) || s.has(t) || !a.has(e.name)) && J("The bundle contains duplicate or unreferenced skill packages."), o.add(e.name), s.add(t);
		let n = /* @__PURE__ */ new Set();
		for (let t of e.files) {
			jp(t.path);
			let e = t.path.toLowerCase();
			if (n.has(e) && J("The bundle contains duplicate package file paths."), n.add(e), c += Mp(t.content).length, l += 1, c > 20971520 || l > 2e3) throw new Tp("BUNDLE_TOO_LARGE", "Bundles are limited to 20 MiB and 2,000 files.");
		}
		for (let e of n) {
			let t = e.split("/");
			for (; t.length > 1;) t.pop(), n.has(t.join("/")) && J("A package file conflicts with a directory.");
		}
		let r = e.files.find((e) => e.path === "SKILL.md");
		r || J("Each skill package must include SKILL.md.");
		let i;
		try {
			i = wf(Cf(Mp(r.content).toString("utf8")).data, "name") ?? e.directory;
		} catch {
			J("A bundled SKILL.md has invalid frontmatter.");
		}
		i !== e.name && J("A bundled skill name does not match its SKILL.md or directory.");
	}
	if (o.size !== a.size && J("The bundle is missing a referenced skill package."), r.version === 2) {
		let e = r.chain.agent;
		if (e === void 0 != (r.agents.length === 0) && J("The bundle agent inventory does not match the selected native agent."), e !== void 0) {
			let t = r.agents[0];
			t !== void 0 && t.name === e.name && t.harness === e.harness && t.agentPath === e.agentPath && t.fingerprint === e.fingerprint && Lp(t.agentPath, t.harness) || J("The bundled native agent does not match the chain selection.");
			let n = Mp(t.content);
			if (c += n.length, l += 1, c > 20971520 || l > 2e3) throw new Tp("BUNDLE_TOO_LARGE", "Bundles are limited to 20 MiB and 2,000 files.");
			u("sha256").update(n).digest("hex") !== t.fingerprint && J("The bundled native agent fingerprint does not match its content.");
		}
	}
	return r;
}
function Ip(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
function Lp(e, t) {
	let n = e.split("/");
	return e.startsWith("/") || e.includes("\\") || n.some((e) => e === "" || e === "." || e === ".." || !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(e) || /[. ]$/.test(e) || Ep.test(e) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(e)) ? !1 : t === "opencode" ? e.endsWith(".md") : e.endsWith(".agent.md");
}
// src/shared/project-claim.ts
var Rp = "project-claim.sqlite", zp = 1280266061, Bp = 2, Vp = zp, Hp = 8388608, Up = 1048576, Wp = "CREATE TABLE claim (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)", Gp = "CREATE TABLE protocol (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)", Kp = "CREATE TABLE lifecycle (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)", qp = I({
	version: R(1),
	projectPath: N(),
	projectDevice: N().regex(/^[0-9]+$/),
	projectInode: N().regex(/^[0-9]+$/),
	enabledAt: Nc({ offset: !0 })
}), Jp = I({
	version: R(1),
	projectPath: N(),
	projectDevice: N().regex(/^[0-9]+$/),
	projectInode: N().regex(/^[0-9]+$/),
	retiredAt: Nc({ offset: !0 })
}), Yp = I({
	version: R(1),
	projectPath: N().refine((e) => i(e) && !e.includes("\0")),
	projectDevice: N().regex(/^[0-9]+$/),
	projectInode: N().regex(/^[0-9]+$/),
	kind: L(["managed", "portable"]),
	runId: N().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	createdAt: Nc({ offset: !0 })
}).refine((e) => e.kind !== "portable" || /^[a-f0-9-]{36}$/.test(e.runId)), Y = class extends Error {
	code;
	constructor(e, t, n) {
		super(t, n), this.code = e, this.name = "ProjectClaimError";
	}
}, Xp = /* @__PURE__ */ new Map();
function Zp(e, t) {
	return e instanceof Error && "code" in e && e.code === t;
}
function X(e, t) {
	return new Y("PROJECT_CLAIM_UNSAFE", e, t === void 0 ? void 0 : { cause: t });
}
async function Qp(t) {
	if (!i(t) || t.includes("\0")) throw X("The project path must be absolute.");
	let n = await y(t), r = await x(n, { bigint: !0 });
	if (!r.isDirectory()) throw X("The project is not a directory.");
	let o = a(n, ".loom");
	try {
		await h(o, { mode: 448 });
	} catch (e) {
		if (!Zp(e, "EEXIST")) throw e;
	}
	let c = await m(o);
	if (!c.isDirectory() || c.isSymbolicLink() || await y(o) !== o) throw X("The project coordination directory is unsafe.");
	await $p(o);
	let l = a(o, Rp);
	try {
		await m(l);
	} catch (t) {
		if (!Zp(t, "ENOENT")) throw X("The project claim database could not be inspected.", t);
		let n = `${l}.${d()}.tmp`;
		await (await g(n, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_NOFOLLOW, 384)).close();
		try {
			let e = new ne(n);
			try {
				e.exec(`PRAGMA synchronous = FULL; BEGIN EXCLUSIVE; ${Wp}; ${Gp}; ${Kp}; PRAGMA user_version = ${Bp}; PRAGMA application_id = ${Vp}; COMMIT`);
			} finally {
				e.close();
			}
			try {
				await p(n, l), await em(o);
			} catch (e) {
				if (!Zp(e, "EEXIST")) throw e;
			}
		} finally {
			await te(n);
		}
		await em(o);
	}
	let u = await m(l);
	for (let e = 0; u.nlink !== 1 && e < 10; e++) await new Promise((e) => setTimeout(e, 10)), u = await m(l);
	if (!u.isFile() || u.isSymbolicLink() || u.nlink !== 1 || u.size > Hp || s(await y(l)) !== l) throw X("The project claim database is unsafe.");
	for (let e of [
		"-journal",
		"-wal",
		"-shm"
	]) try {
		let t = await m(l + e);
		if (!t.isFile() || t.isSymbolicLink() || t.nlink !== 1 || t.size > Hp) throw X("A project claim database sidecar is unsafe.");
	} catch (e) {
		if (!Zp(e, "ENOENT")) throw e;
	}
	return {
		identity: {
			projectPath: n,
			projectDevice: String(r.dev),
			projectInode: String(r.ino)
		},
		path: l
	};
}
async function $p(t) {
	let n;
	try {
		n = await g(a(t, ".gitignore"), e.O_RDWR | e.O_CREAT | e.O_APPEND | e.O_NOFOLLOW, 384);
		let r = await n.stat();
		if (!r.isFile() || r.nlink !== 1 || r.size > Up) throw X("The project ignore file is unsafe.");
		let i = await n.readFile("utf8");
		i.split(/\r?\n/).filter((e) => e !== "").at(-1) !== `${Rp}*` && (await n.writeFile(`${i === "" || i.endsWith("\n") ? "" : "\n"}${Rp}*\n`, "utf8"), await n.sync(), await em(t));
	} catch (e) {
		throw e instanceof Y ? e : X("The project ignore file could not be updated.", e);
	} finally {
		await n?.close();
	}
}
async function em(t) {
	let n = await g(t, e.O_RDONLY);
	try {
		try {
			await n.sync();
		} catch (e) {
			if (!Zp(e, "EINVAL") && !Zp(e, "EISDIR") && !Zp(e, "EPERM") && !Zp(e, "ENOTSUP")) throw e;
		}
	} finally {
		await n.close();
	}
}
function tm(e, t) {
	if (typeof e != "string" || Buffer.byteLength(e, "utf8") > 4096) throw X("The project claim is invalid.");
	let n;
	try {
		n = JSON.parse(e);
	} catch (e) {
		throw X("The project claim is invalid.", e);
	}
	let r = Yp.safeParse(n);
	if (!r.success || r.data.projectPath !== t.projectPath || r.data.projectDevice !== t.projectDevice || r.data.projectInode !== t.projectInode) throw X("The project claim is invalid or belongs to another project.");
	return r.data;
}
async function nm(e, t) {
	return rm(e, t, !1);
}
async function rm(e, t, n) {
	if (!i(e) || e.includes("\0")) throw X("The project path must be absolute.");
	let r;
	try {
		r = await y(e);
	} catch (e) {
		throw X("The project coordination path could not be resolved.", e);
	}
	let a = (Xp.get(r) ?? Promise.resolve()).then(async () => {
		let e, i;
		try {
			({identity: e, path: i} = await Qp(r));
		} catch (e) {
			throw e instanceof Y ? e : X("The project claim database could not be prepared.", e);
		}
		let a, o = !1, s = !0, c = !1;
		try {
			a = new ne(i), a.exec("PRAGMA busy_timeout = 0; PRAGMA synchronous = FULL; BEGIN EXCLUSIVE"), o = !0;
			let r = a.prepare("PRAGMA user_version").get()?.user_version;
			if (r !== 1 && r !== Bp) throw X("The project claim database has an unsupported or incomplete version.");
			if (a.prepare("PRAGMA application_id").get()?.application_id !== Vp) throw X("The project claim database identity is invalid.");
			if (a.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete") throw X("The project claim database journal mode is unsupported.");
			let l = a.prepare("SELECT type, name, sql FROM sqlite_master").all();
			if (l.length !== (r === 1 ? 2 : 3) || !l.some((e) => e.type === "table" && e.name === "claim" && e.sql === Wp) || !l.some((e) => e.type === "table" && e.name === "protocol" && e.sql === Gp) || r === Bp && !l.some((e) => e.type === "table" && e.name === "lifecycle" && e.sql === Kp)) throw X("The project claim database schema is invalid.");
			if (a.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") throw X("The project claim database is corrupt.");
			r === 1 && a.exec(`${Kp}; PRAGMA user_version = ${Bp}`);
			let u = a, d = () => {
				if (!s) throw X("The project claim transaction is no longer active.");
				let t = u.prepare("SELECT id, document FROM claim").all();
				if (t.length === 0) return null;
				if (t.length !== 1 || t[0]?.id !== 1) throw X("The project claim database contains invalid rows.");
				return tm(t[0].document, e);
			}, f = () => {
				if (!s) throw X("The project claim transaction is no longer active.");
				let t = u.prepare("SELECT id, document FROM protocol").all();
				if (t.length === 0) return null;
				if (t.length !== 1 || t[0]?.id !== 1 || typeof t[0].document != "string" || Buffer.byteLength(t[0].document, "utf8") > 4096) throw X("The project protocol record is invalid.");
				let n;
				try {
					n = JSON.parse(t[0].document);
				} catch (e) {
					throw X("The project protocol record is invalid.", e);
				}
				let r = qp.safeParse(n);
				if (!r.success || r.data.projectPath !== e.projectPath || r.data.projectDevice !== e.projectDevice || r.data.projectInode !== e.projectInode) throw X("The project protocol record is invalid or belongs to another project.");
				return r.data;
			}, p = () => {
				if (!s) throw X("The project claim transaction is no longer active.");
				let t = u.prepare("SELECT id, document FROM lifecycle").all();
				if (t.length === 0) return !1;
				if (t.length !== 1 || t[0]?.id !== 1 || typeof t[0].document != "string" || Buffer.byteLength(t[0].document, "utf8") > 4096) throw X("The project retirement record is invalid.");
				let n;
				try {
					n = JSON.parse(t[0].document);
				} catch (e) {
					throw X("The project retirement record is invalid.", e);
				}
				let r = Jp.safeParse(n);
				if (!r.success || r.data.projectPath !== e.projectPath || r.data.projectDevice !== e.projectDevice || r.data.projectInode !== e.projectInode) throw X("The project retirement record is invalid or belongs to another project.");
				return !0;
			}, m = () => {
				if (p()) throw new Y("PROJECT_CLAIM_RETIRED", "This workspace is being removed and cannot start or change runs.");
			}, h = {
				identity: e,
				protocol: f,
				enableProtocol(t) {
					if (m(), f() !== null) return;
					let n = qp.safeParse({
						version: 1,
						...e,
						enabledAt: t
					});
					if (!n.success) throw X("The project protocol record is invalid.");
					u.prepare("INSERT INTO protocol (id, document) VALUES (1, ?)").run(JSON.stringify(n.data));
				},
				read: d,
				acquire(t) {
					m();
					let n = Yp.safeParse(t);
					if (!n.success || n.data.projectPath !== e.projectPath || n.data.projectDevice !== e.projectDevice || n.data.projectInode !== e.projectInode) throw X("The new project claim is invalid.");
					if (d() !== null) throw new Y("PROJECT_CLAIM_CONFLICT", "Another operation already claims this project.");
					u.prepare("INSERT INTO claim (id, document) VALUES (1, ?)").run(JSON.stringify(n.data));
				},
				release(e) {
					m();
					let t = d();
					if (t === null || t.kind !== e.kind || t.runId !== e.runId) throw new Y("PROJECT_CLAIM_MISMATCH", "The project claim does not match this run.");
					u.prepare("DELETE FROM claim WHERE id = 1").run();
				},
				retired: p,
				retire(t) {
					if (p()) return;
					if (d() !== null) throw new Y("PROJECT_CLAIM_CONFLICT", "A claimed project cannot be retired.");
					let n = Jp.safeParse({
						version: 1,
						...e,
						retiredAt: t
					});
					if (!n.success) throw X("The project retirement record is invalid.");
					u.prepare("INSERT INTO lifecycle (id, document) VALUES (1, ?)").run(JSON.stringify(n.data));
				}
			};
			d(), f(), n || m();
			let g;
			try {
				g = await t(h);
			} catch (e) {
				throw c = !0, e;
			}
			return s = !1, a.exec("COMMIT"), o = !1, g;
		} catch (e) {
			if (s = !1, o) try {
				a?.exec("ROLLBACK");
			} catch (t) {
				throw AggregateError([e, t], "The project claim transaction and rollback failed.");
			}
			throw c || e instanceof Y ? e : typeof e == "object" && e && "errcode" in e && typeof e.errcode == "number" && (e.errcode & 255) == 5 ? new Y("PROJECT_CLAIM_BUSY", "Another process is updating the project claim.", { cause: e }) : X("The project claim transaction failed.", e);
		} finally {
			a?.close();
		}
	}), o = a.then(() => void 0, () => void 0);
	return Xp.set(r, o), o.then(() => {
		Xp.get(r) === o && Xp.delete(r);
	}), a;
}
var im = 8192, am = 1e3, om = /^[a-f0-9-]{36}$/, sm = oc(N().regex(/^[A-Za-z][A-Za-z0-9_]*$/), N().max(16384)), cm = I({
	number: Hs().int().positive(),
	status: L([
		"running",
		"done",
		"failed",
		"skipped",
		"interrupted"
	]),
	startedAt: Nc({ offset: !0 }),
	finishedAt: Nc({ offset: !0 }).nullable(),
	summary: N().max(im).nullable(),
	reason: N().max(2e3).nullable()
}), lm = I({
	version: R(1),
	id: N().regex(om),
	revision: Hs().int().positive(),
	projectPath: N().min(1),
	bundleFingerprint: N().regex(/^[a-f0-9]{64}$/),
	bundle: Ac((e) => {
		try {
			return Fp(e), !0;
		} catch {
			return !1;
		}
	}),
	actualHost: L([
		"copilot",
		"opencode",
		"other"
	]),
	hostSwitchConfirmed: Ks(),
	progression: L(["supervised", "agent"]),
	progressionConfirmed: Ks(),
	sessionDecision: I({
		requested: L([
			"shared",
			"fresh",
			"fork"
		]),
		mechanism: L([
			"current-conversation",
			"isolated-worker",
			"native-fork",
			"handoff"
		]),
		description: N().trim().min(1).max(500),
		confirmed: Ks()
	}),
	resolvedInputs: sm,
	installedSkills: F(I({
		name: N(),
		directory: N(),
		fingerprint: N().regex(/^[a-f0-9]{64}$/),
		reused: Ks()
	})),
	status: L([
		"ready",
		"running",
		"paused",
		"failed",
		"completed",
		"aborted",
		"interrupted"
	]),
	currentStepIndex: Hs().int().min(0),
	resumeRequired: Ks(),
	steps: F(I({
		id: N().min(1),
		index: Hs().int().min(0),
		attempts: F(cm).max(50)
	})).min(1).max(am),
	createdAt: Nc({ offset: !0 }),
	updatedAt: Nc({ offset: !0 })
});
function um(e, t, n) {
	let r = lm.safeParse(e);
	if (!r.success || r.data.projectPath !== t || r.data.id !== n) return null;
	let i = Fp(r.data.bundle);
	return u("sha256").update(JSON.stringify(i)).digest("hex") !== r.data.bundleFingerprint || i.chain.steps.length !== r.data.steps.length || i.chain.steps.some((e, t) => r.data.steps[t]?.id !== e.id) ? null : r.data;
}
var dm = L(["supervised", "automatic"]), fm = L([
	"starting",
	"running",
	"awaiting-user",
	"paused",
	"failed",
	"completed",
	"aborted",
	"interrupted"
]), pm = L([
	"pending",
	"running",
	"done",
	"failed",
	"skipped",
	"interrupted"
]), mm = L([
	"none",
	"native",
	"handoff"
]), hm = L([
	"unknown",
	"not-observable",
	"observed",
	"not-observed"
]), gm = 32768, _m = 2e3, vm = N().trim().min(1), ym = Nc({ offset: !0 }), bm = N().max(_m).nullable().default(null);
oc(N(), N().nullable());
var xm = N().refine(Pm, { message: `A step tail must be at most 200 lines and ${String(gm)} bytes.` }).default(""), Sm = {
	id: vm,
	index: Hs().int().min(0),
	label: vm.nullable().default(null),
	status: pm,
	startedAt: ym.nullable().default(null),
	finishedAt: ym.nullable().default(null),
	exitCode: Hs().int().nullable().default(null),
	sessionId: vm.nullable().default(null),
	forkMechanism: mm,
	skillObservation: hm.default("unknown"),
	tail: xm,
	reason: bm
}, Cm = nc("kind", [I({
	...Sm,
	kind: R("skill").optional(),
	skillName: vm
}), I({
	...Sm,
	kind: R("instruction"),
	skillName: Xs().optional()
})]), wm = I({
	version: R(1),
	id: vm,
	projectId: vm,
	chainId: vm,
	harness: L(Of),
	mode: dm,
	sessionMode: qf,
	chainSnapshot: q,
	resolvedInputs: oc(N(), N()).default({}),
	status: fm,
	currentStepIndex: Hs().int().min(0),
	createdAt: ym,
	updatedAt: ym,
	startedAt: ym.nullable().default(null),
	finishedAt: ym.nullable().default(null),
	sessionId: vm.nullable().default(null),
	forkMechanism: mm,
	steps: F(Cm).min(1),
	reason: bm
}), Tm = {
	STEP_COUNT_MISMATCH: "run_step_count_mismatch",
	STEP_ID_MISMATCH: "run_step_id_mismatch",
	STEP_INDEX_MISMATCH: "run_step_index_mismatch",
	STEP_SKILL_MISMATCH: "run_step_skill_mismatch",
	CURRENT_STEP_OUT_OF_RANGE: "run_current_step_out_of_range",
	INPUT_UNDECLARED: "run_input_undeclared",
	INPUT_REQUIRED: "run_input_required",
	TAIL_TOO_LARGE: "run_tail_too_large"
}, Em = class extends Error {
	code;
	details;
	constructor(e, t, n = {}, r = {}) {
		super(t, r.cause === void 0 ? void 0 : { cause: r.cause }), this.name = new.target.name, this.code = e, this.details = n;
	}
}, Dm = class extends Em {
	issues;
	constructor(e) {
		super("RUN_INVALID", "The run record is not valid.", { issues: e }), this.issues = e;
	}
}, Om = class extends Em {
	constructor(e) {
		super("RUN_UNSUPPORTED_VERSION", "The run uses an unsupported version.", {
			version: Lm(e),
			supportedVersion: 1
		});
	}
};
function km(e) {
	if (!Im(e)) return e;
	let t = e.chainSnapshot;
	return {
		...e,
		...Object.hasOwn(e, "version") ? {} : { version: 1 },
		...t === void 0 ? {} : { chainSnapshot: dp(t) }
	};
}
function Am(e) {
	if (Im(e) && Object.hasOwn(e, "version") && e.version !== 1) throw new Om(e.version);
	return jm(km(e));
}
function jm(e) {
	let t = wm.safeParse(e);
	if (!t.success) throw new Dm(Fm(t.error.issues));
	let n = t.data, r = [], i = n.chainSnapshot.steps;
	n.steps.length !== i.length && r.push({
		path: "steps",
		code: Tm.STEP_COUNT_MISMATCH,
		message: `The run has ${String(n.steps.length)} step records for ${String(i.length)} snapshot steps.`
	}), n.steps.forEach((e, t) => {
		let n = i[t];
		n !== void 0 && (e.index !== t && r.push({
			path: `steps.${String(t)}.index`,
			code: Tm.STEP_INDEX_MISMATCH,
			stepId: e.id,
			stepIndex: t,
			message: `Step record ${String(t)} records index ${String(e.index)}.`
		}), e.id !== n.id && r.push({
			path: `steps.${String(t)}.id`,
			code: Tm.STEP_ID_MISMATCH,
			stepId: e.id,
			stepIndex: t,
			message: `Step record ${String(t)} does not match the frozen snapshot step id.`
		}), (e.skillName !== n.skillName || e.kind === "instruction" != (n.kind === "instruction")) && r.push({
			path: `steps.${String(t)}.skillName`,
			code: Tm.STEP_SKILL_MISMATCH,
			stepId: e.id,
			stepIndex: t,
			message: `Step record ${String(t)} does not match the frozen snapshot skill.`
		}), Pm(e.tail) || r.push({
			path: `steps.${String(t)}.tail`,
			code: Tm.TAIL_TOO_LARGE,
			stepId: e.id,
			stepIndex: t,
			message: `The step tail exceeds 200 lines or ${String(gm)} bytes.`
		}));
	}), (n.currentStepIndex < 0 || n.currentStepIndex >= n.steps.length) && r.push({
		path: "currentStepIndex",
		code: Tm.CURRENT_STEP_OUT_OF_RANGE,
		message: "The current step index is outside the frozen step list."
	});
	let a = new Map(n.chainSnapshot.inputs.map((e) => [e.name, e]));
	for (let e of Object.keys(n.resolvedInputs)) a.has(e) || r.push({
		path: `resolvedInputs.${e}`,
		code: Tm.INPUT_UNDECLARED,
		inputName: e,
		message: `Resolved input "${e}" is not declared by the frozen chain.`
	});
	for (let e of n.chainSnapshot.inputs) {
		let t = n.resolvedInputs[e.name] ?? "";
		e.required && t.trim() === "" && r.push({
			path: `resolvedInputs.${e.name}`,
			code: Tm.INPUT_REQUIRED,
			inputName: e.name,
			message: `Required input "${e.name}" is unresolved.`
		});
	}
	if (r.length > 0) throw new Dm(r);
	return n;
}
function Mm(e) {
	return e === "" ? 0 : e.split("\n").length;
}
function Nm(e) {
	return Buffer.byteLength(e, "utf8");
}
function Pm(e) {
	return Mm(e) <= 200 && Nm(e) <= 32768;
}
function Fm(e) {
	return e.map((e) => ({
		path: e.path.map((e) => String(e)).join("."),
		code: e.code,
		message: e.message
	}));
}
function Im(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
function Lm(e) {
	return e === null || [
		"string",
		"number",
		"boolean"
	].includes(typeof e) ? e : Array.isArray(e) ? "array" : typeof e;
}
// src/shared/project-run-records.ts
var Rm = 1e3, zm = 67108864, Bm = 31457280, Vm = /^[a-z0-9][a-z0-9_-]{0,63}$/, Z = class extends Error {
	code = "PROJECT_RUN_RECORDS_UNSAFE";
	constructor(e, t) {
		super(e, t), this.name = "ProjectRunRecordsError";
	}
};
function Hm(e) {
	return e instanceof Error && "code" in e && e.code === "ENOENT";
}
async function Um(t, n) {
	let r = await g(t, e.O_RDONLY | e.O_NOFOLLOW | e.O_NONBLOCK);
	try {
		let e = await r.stat({ bigint: !0 }), t = Math.min(Bm, n);
		if (!e.isFile() || e.nlink !== 1n || e.size > BigInt(t)) throw new Z("A project run record is unsafe or exceeds the scan budget.");
		let i = Buffer.alloc(Number(e.size)), a = 0;
		for (; a < i.length;) {
			let { bytesRead: e } = await r.read(i, a, i.length - a, a);
			if (e === 0) throw new Z("A project run record changed during inspection.");
			a += e;
		}
		let o = await r.stat({ bigint: !0 });
		if (e.dev !== o.dev || e.ino !== o.ino || e.size !== o.size || e.mtimeNs !== o.mtimeNs || e.ctimeNs !== o.ctimeNs) throw new Z("A project run record changed during inspection.");
		let s = new TextDecoder("utf-8", { fatal: !0 }).decode(i);
		return {
			document: JSON.parse(s),
			bytes: i.length,
			fingerprint: u("sha256").update(i).digest("hex")
		};
	} finally {
		await r.close();
	}
}
async function Wm(e) {
	let t = [], n = 0;
	for (let r of ["managed", "portable"]) {
		let i = a(e, ".loom", r === "managed" ? "runs" : "portable-runs"), o;
		try {
			o = await m(i);
		} catch (e) {
			if (Hm(e)) continue;
			throw new Z("The project run directory could not be inspected.", { cause: e });
		}
		if (!o.isDirectory() || o.isSymbolicLink() || await y(i) !== i) throw new Z("The project run directory is unsafe.");
		let s = await _(i);
		for await (let o of s) {
			if (!o.name.endsWith(".json")) continue;
			let s = o.name.slice(0, -5);
			if (!(r === "managed" ? Vm : om).test(s)) throw new Z("A project run record has an invalid name.");
			if (t.length >= Rm) throw new Z("The project run record count exceeds the scan budget.");
			try {
				let c = await Um(a(i, o.name), zm - n);
				if (n += c.bytes, r === "managed") {
					let e = Am(c.document);
					if (e.id !== s) throw new Z("A project run record id does not match its filename.");
					t.push({
						kind: r,
						runId: s,
						status: e.status,
						fingerprint: c.fingerprint,
						unresolved: e.status !== "completed" && e.status !== "aborted" || e.steps.some((e) => e.status === "running")
					});
				} else {
					let n = um(c.document, e, s);
					if (n === null) throw new Z("A portable run record is invalid.");
					let i = n.resumeRequired || n.steps.some((e) => e.attempts.some((e) => e.status === "running"));
					t.push({
						kind: r,
						runId: s,
						status: n.status,
						fingerprint: c.fingerprint,
						unresolved: i || n.status !== "completed" && n.status !== "aborted"
					});
				}
			} catch (e) {
				throw e instanceof Z ? e : new Z("A project run record could not be validated.", { cause: e });
			}
		}
	}
	return t.sort((e, t) => e.kind.localeCompare(t.kind) || e.runId.localeCompare(t.runId));
}
// src/shared/project-coordination.ts
var Gm = class extends Error {
	code;
	records;
	constructor(e, t = []) {
		super(e === "PROJECT_PROTOCOL_NOT_ENABLED" ? "Review and enable coordinated project execution before starting a run." : e === "PROJECT_REVIEW_STALE" ? "Project coordination evidence changed; review it again." : e === "PROJECT_CONFIRMATION_REQUIRED" ? "Confirm that prior work, processes, and older clients have stopped." : "Existing project runs have unresolved ownership and require explicit reconciliation."), this.code = e, this.records = t, this.name = "ProjectCoordinationError";
	}
};
async function Km(e, t, n, r = !1) {
	let i = performance.now() + 1e3;
	for (;;) {
		let a = !1;
		try {
			return await nm(e, async (e) => {
				if (a = !0, e.protocol() === null) throw new Gm("PROJECT_PROTOCOL_NOT_ENABLED");
				let r = e.read();
				if (r === null || r.kind !== t.kind || r.runId !== t.runId) throw new Y("PROJECT_CLAIM_MISMATCH", "The project claim does not match this run.");
				return n(r);
			});
		} catch (e) {
			let t = i - performance.now();
			if (!r || a || !(e instanceof Y) || e.code !== "PROJECT_CLAIM_BUSY" || t <= 0) throw e;
			await new Promise((e) => setTimeout(e, Math.min(25, t)));
		}
	}
}
async function qm(e, t, n, r, i = /* @__PURE__ */ new Date()) {
	let a = await nm(e, async (e) => {
		if (e.read() !== null) throw new Y("PROJECT_CLAIM_CONFLICT", "Another operation already claims this project.");
		if (e.protocol() === null) return {
			kind: "legacy",
			value: await r()
		};
		let a = (await Wm(e.identity.projectPath)).filter((e) => e.unresolved);
		if (a.length > 0) throw new Gm("PROJECT_RECONCILIATION_REQUIRED", a);
		return e.acquire({
			version: 1,
			...e.identity,
			kind: t,
			runId: n,
			createdAt: i.toISOString()
		}), { kind: "claimed" };
	});
	return a.kind === "legacy" ? a.value : Km(e, {
		kind: t,
		runId: n
	}, r, !0);
}
async function Jm(e, t, n) {
	return nm(e, async (e) => {
		let r = e.protocol(), i = e.read();
		if (r !== null) {
			if (i === null || i.kind !== t.kind || i.runId !== t.runId) throw new Y("PROJECT_CLAIM_MISMATCH", "The project claim does not match this run.");
		} else if (i !== null) throw new Y("PROJECT_CLAIM_CONFLICT", "Another operation already claims this project.");
		return n(i);
	});
}
// src/portable/runtime.ts
var Ym = 65536, Xm = 1e3, Zm = 67108864, Qm = class extends Error {
	code;
	constructor(e, t) {
		super(t), this.code = e, this.name = "PortableRunError";
	}
};
function Q(e, t) {
	throw new Qm(e, t);
}
function $() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function $m(e) {
	return u("sha256").update(e).digest("hex");
}
function eh(e) {
	let t = u("sha256"), r = /* @__PURE__ */ new Set(), i = new Map(e.map((e) => [e.path, e]));
	for (let t of e) {
		let e = t.path.split("/");
		for (e.pop(); e.length > 0;) r.add(e.join("/")), e.pop();
	}
	function a(e) {
		let o = /* @__PURE__ */ new Set();
		for (let t of r) th(t) === e && o.add(t);
		for (let t of i.keys()) th(t) === e && o.add(t);
		for (let e of [...o].sort((e, t) => n(e).localeCompare(n(t)))) if (r.has(e)) t.update(e).update("\0d\0"), a(e);
		else {
			let n = i.get(e);
			t.update(e).update("\0f\0").update(n.executable ? "1" : "0").update("\0"), t.update(Mp(n.content)).update("\0");
		}
	}
	return a(""), t.digest("hex");
}
function th(e) {
	let t = e.lastIndexOf("/");
	return t < 0 ? "" : e.slice(0, t);
}
function nh(e, t) {
	let n = sm.safeParse(t ?? {});
	n.success || Q("INPUT_INVALID", "Input values must be named strings no longer than 16 KiB.");
	let r = new Set(e.chain.inputs.map((e) => e.name));
	Object.keys(n.data).some((e) => !r.has(e)) && Q("INPUT_INVALID", "An input value was supplied for an undeclared chain input.");
	let i = {};
	e.chain.inputs.length > 256 && Q("INPUTS_TOO_MANY", "Portable chains are limited to 256 inputs.");
	for (let t of e.chain.inputs) {
		let e = Object.hasOwn(n.data, t.name) ? n.data[t.name] : t.defaultValue;
		e === void 0 ? t.required && Q("INPUT_REQUIRED", `Required input "${t.name}" needs a value.`) : (t.required && e.trim() === "" && Q("INPUT_REQUIRED", `Required input "${t.name}" cannot be empty.`), i[t.name] = e);
	}
	return i;
}
function rh(e, t, n) {
	let r = e.chain.steps[t];
	r || Q("STEP_NOT_FOUND", "No active chain step exists.");
	let i = r.instruction.replace(/\{\{([^{}]*)\}\}/g, (e, t) => {
		let r = t.trim();
		return Object.hasOwn(n, r) || Q("INPUT_UNRESOLVED", `Input "${r}" has no resolved value.`), n[r];
	});
	return r.kind === "instruction" ? `Instruction:\n${i}` : `Skill: ${r.skillName}\n\nInstruction:\n${i}`;
}
async function ih(e) {
	try {
		await h(e, { mode: 448 });
	} catch (e) {
		if (!ah(e, "EEXIST")) throw e;
	}
	let t = await m(e);
	(!t.isDirectory() || t.isSymbolicLink() || await y(e) !== e) && Q("PATH_UNSAFE", "A required directory is not a real directory.");
}
function ah(e, t) {
	return e instanceof Error && "code" in e && e.code === t;
}
async function oh(e) {
	i(e) || Q("PROJECT_INVALID", "The project path must be absolute.");
	let t = await y(e);
	return (await x(t)).isDirectory() || Q("PROJECT_INVALID", "The project path is not a directory."), t;
}
async function sh(e) {
	let t = a(e, ".agents"), n = a(t, "skills");
	return await ih(t), await ih(n), n;
}
async function ch(t, n, r = !1) {
	let i;
	try {
		i = await g(t, e.O_RDONLY | e.O_NOFOLLOW | (r ? e.O_NONBLOCK : 0));
	} catch (e) {
		throw ah(e, "ELOOP") && Q("PACKAGE_UNSAFE", "An existing package file is a symbolic link."), e;
	}
	try {
		let e = await i.stat();
		(!e.isFile() || e.size > n) && Q("PACKAGE_TOO_LARGE", "An existing package file is unsafe or exceeds the portable review limit.");
		let t = Buffer.alloc(e.size + 1), r = 0;
		for (; r < t.length;) {
			let { bytesRead: e } = await i.read(t, r, t.length - r, r);
			if (e === 0) break;
			r += e;
		}
		let a = await i.stat();
		return (r !== e.size || a.size !== e.size || a.mtimeMs !== e.mtimeMs || a.mode !== e.mode) && Q("PACKAGE_CHANGED", "An existing package changed while it was inspected. Review it again."), {
			content: t.subarray(0, r),
			executable: !!(e.mode & 73)
		};
	} finally {
		await i.close();
	}
}
async function lh(e, t, n = {
	files: Cp,
	bytes: Sp
}) {
	let r = u("sha256"), i = 0, o = 0, s = 0, c = 0;
	function l(e) {
		t !== void 0 && (c += Buffer.byteLength(JSON.stringify(e), "utf8") + 1, c > (n.inventoryBytes ?? 2 ** 53 - 1) && Q("PACKAGE_TOO_LARGE", "The existing package inventory exceeds the portable review limit."), t.push(e));
	}
	async function d(e, c, u) {
		(u > 32 || await y(e) !== e) && Q("PACKAGE_UNSAFE", "An installed skill has unsafe directories or exceeds the depth limit.");
		let f = [];
		for await (let t of await _(e)) s += 1, s > (n.entries ?? 66e3) && Q("PACKAGE_TOO_LARGE", "The existing package exceeds the portable review entry limit."), f.push(t);
		f.sort((e, t) => e.name.localeCompare(t.name));
		for (let s of f) {
			let f = a(e, s.name), p = c === "" ? s.name : `${c}/${s.name}`, h = await m(f);
			if (h.isSymbolicLink() && Q("PACKAGE_UNSAFE", "An installed skill contains a symbolic link."), h.isDirectory()) r.update(p).update("\0d\0"), l({
				path: p,
				kind: "directory"
			}), await d(f, p, u + 1);
			else if (h.isFile()) {
				o += 1, o > n.files && Q("PACKAGE_TOO_LARGE", "The existing package exceeds the portable review file limit.");
				let e = await ch(f, n.bytes - i);
				i += e.content.length, r.update(p).update("\0f\0").update(e.executable ? "1" : "0").update("\0"), r.update(e.content).update("\0"), t !== void 0 && l({
					path: p,
					kind: "file",
					bytes: e.content.length,
					executable: e.executable,
					fingerprint: $m(e.content)
				});
			} else Q("PACKAGE_UNSAFE", "An installed skill contains a special file.");
		}
	}
	return await d(e, "", 0), r.digest("hex");
}
async function uh(t, n, i, s, l) {
	let u = await sh(n), d = new Set(i);
	(d.size !== i.length || [...d].some((e) => !t.skills.some((t) => t.name === e))) && Q("REUSE_INVALID", "Reuse choices must name distinct skills included in the bundle.");
	let p = [], _ = [];
	try {
		for (let n of t.skills) {
			let t = a(u, n.directory);
			(o(u, t).startsWith(`..${c}`) || o(u, t) === "..") && Q("PATH_UNSAFE", "A skill destination escapes the project skill directory.");
			let i = !1;
			try {
				await m(t), i = !0;
			} catch (e) {
				if (!ah(e, "ENOENT")) throw e;
			}
			if (i) {
				let e = await m(t);
				e.isDirectory() && !e.isSymbolicLink() && d.has(n.name) || Q("PACKAGE_CONFLICT", `Skill "${n.name}" already exists. Review it and explicitly choose reuse or cancel.`);
				let r = a(t, "SKILL.md"), i = await m(r);
				(!i.isFile() || i.isSymbolicLink()) && Q("PACKAGE_CONFLICT", `Existing "${n.name}" is not a valid skill package.`), (wf(Cf((await ch(r, Sp)).content.toString("utf8")).data, "name") ?? n.directory) !== n.name && Q("PACKAGE_CONFLICT", `Existing skill directory does not contain "${n.name}".`);
				let o = await lh(t);
				o !== l.get(n.name) && Q("REVIEW_STALE", `Existing "${n.name}" changed since inspection; inspect and review it again.`), o !== eh(n.files) && !s && Q("REUSE_CONTENT_CONFIRMATION_REQUIRED", `Existing "${n.name}" differs from the bundle; explicitly confirm reuse of its installed contents.`), p.push({
					name: n.name,
					directory: n.directory,
					fingerprint: o,
					reused: !0
				});
			} else {
				l.get(n.name) !== null && Q("REVIEW_STALE", `Existing "${n.name}" changed since inspection; inspect and review it again.`), d.has(n.name) && Q("REUSE_MISSING", `Skill "${n.name}" selected for reuse is missing.`), await h(t, { mode: 493 }), _.push(t);
				for (let i of n.files) {
					let n = a(t, ...i.path.split("/")), s = r(n), l = o(t, s).split(c).filter(Boolean), u = t;
					for (let e of l) u = a(u, e), await ih(u);
					let d = await g(n, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_NOFOLLOW, i.executable ? 493 : 420);
					try {
						await d.writeFile(Mp(i.content)), await d.sync();
					} finally {
						await d.close();
					}
					await f(n, i.executable ? 493 : 420);
				}
				p.push({
					name: n.name,
					directory: n.directory,
					fingerprint: await lh(t),
					reused: !1
				});
			}
		}
		return {
			installedSkills: p,
			createdDirectories: _
		};
	} catch (e) {
		throw await Promise.all(_.map((e) => b(e, {
			recursive: !0,
			force: !0
		}))), e instanceof Qm || e instanceof Tp ? e : new Qm("INSTALL_FAILED", "Skill installation failed; newly created package directories were rolled back.");
	}
}
async function dh(t) {
	let n = a(t, ".loom"), r = a(n, "portable-runs");
	await ih(n), await ih(r);
	let i = a(n, ".gitignore");
	try {
		let t = await g(i, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_NOFOLLOW, 384);
		try {
			await t.writeFile("runs/\nportable-runs/\n", "utf8"), await t.sync();
		} finally {
			await t.close();
		}
	} catch (e) {
		if (!ah(e, "EEXIST")) throw e;
		let t = await m(i);
		(!t.isFile() || t.isSymbolicLink()) && Q("PATH_UNSAFE", "The Loom ignore file is not a regular file.");
		let n = await v(i, "utf8"), r = n.split(/\r?\n/).filter((e) => e !== "" && !e.startsWith("#")), a = r.at(-1) === "portable-runs/" && r.at(-2) === "runs/" ? [] : r.at(-1) === "runs/" ? ["portable-runs/"] : ["runs/", "portable-runs/"];
		a.length > 0 && await ph(i, `${n}${n.endsWith("\n") || n === "" ? "" : "\n"}${a.join("\n")}\n`);
	}
	return r;
}
async function fh(e, t, n = !1) {
	return ph(e, `${JSON.stringify(t, null, 2)}\n`, n);
}
async function ph(t, n, i = !1) {
	let o = a(r(t), `.${d()}.tmp`);
	try {
		let a = await g(o, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_NOFOLLOW, 384);
		try {
			await a.writeFile(n, "utf8"), await a.sync();
		} finally {
			await a.close();
		}
		i ? (await p(o, t), await te(o)) : await ee(o, t), await mh(r(t));
	} catch (e) {
		throw await b(o, { force: !0 }), e;
	}
}
async function mh(t) {
	let n = await g(t, e.O_RDONLY);
	try {
		try {
			await n.sync();
		} catch (e) {
			if (!ah(e, "EINVAL") && !ah(e, "EISDIR") && !ah(e, "EPERM") && !ah(e, "ENOTSUP")) throw e;
		}
	} finally {
		await n.close();
	}
}
async function hh(t, n) {
	let r = a(t, ".lock"), i;
	try {
		i = await g(r, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_NOFOLLOW, 384);
	} catch (e) {
		throw ah(e, "EEXIST") && Q("RUN_LOCKED", "Another helper process is mutating portable run state; retry after it exits."), e;
	}
	try {
		return await i.writeFile(`${process.pid}\n`, "utf8"), await i.sync(), await n();
	} finally {
		await i.close(), await b(r, { force: !0 });
	}
}
async function gh(e, t, r = wp) {
	let i;
	try {
		({content: i} = await ch(e, r, !0));
	} catch (e) {
		if (!(e instanceof Qm)) throw e;
		e.code === "PACKAGE_TOO_LARGE" && r < 31457280 && Q("RUN_SCAN_TOO_LARGE", "Portable run records exceed the conflict scan budget; archive completed records before retrying."), Q("RUN_FILE_INVALID", "The portable run record is unsafe, changed during inspection, or exceeds its size limit.");
	}
	let a;
	try {
		a = JSON.parse(i.toString("utf8"));
	} catch (e) {
		if (!(e instanceof SyntaxError)) throw e;
		Q("RUN_FILE_INVALID", "The portable run record is corrupt, unsupported, or belongs to another project.");
	}
	let o = n(e).slice(0, -5), s = um(a, t, o);
	return (s === null || n(e) !== `${s.id}.json`) && Q("RUN_FILE_INVALID", "The portable run record is corrupt, unsupported, or belongs to another project."), {
		run: s,
		bytes: i.length
	};
}
async function _h(e, t) {
	return (await gh(e, t)).run;
}
async function vh(e, t, n) {
	let r = 0, i = 0, a = await _(e);
	for await (let o of a) {
		if (!o.name.endsWith(".json")) continue;
		let a = o.name.slice(0, -5);
		if (om.test(a) || Q("RUN_FILE_INVALID", "The portable run directory contains an invalid run record name."), a === n) continue;
		r += 1, r > Xm && Q("RUN_SCAN_TOO_LARGE", "Too many portable run records to check for conflicts; archive completed records before retrying.");
		let s = await gh(bh(e, a), t, Math.min(wp, Zm - i));
		i += s.bytes;
		let { run: c } = s, l = c.status === "completed" || c.status === "aborted" || c.status === "failed";
		l && (c.resumeRequired || c.steps.some((e) => e.attempts.some((e) => e.status === "running"))) && Q("RUN_FILE_INVALID", "A finished portable run contains an unresolved attempt."), l || Q("RUN_ACTIVE_CONFLICT", "Another portable run is unfinished; finish or explicitly abort it before continuing.");
	}
}
async function yh(e, t) {
	for (let n of e.installedSkills) {
		let e = a(t, ".agents", "skills", n.directory), r = await m(e);
		(!r.isDirectory() || r.isSymbolicLink() || await lh(e) !== n.fingerprint) && Q("PACKAGE_CHANGED", `Installed skill "${n.name}" changed since this run was prepared; review it and prepare a new run.`);
	}
}
function bh(e, t) {
	return om.test(t) || Q("RUN_ID_INVALID", "The run id is not safe."), a(e, `${t}.json`);
}
async function xh(e) {
	return e === void 0 ? {} : ((typeof e != "object" || !e || Array.isArray(e)) && Q("REQUEST_INVALID", "The request must be a JSON object."), e);
}
async function Sh(e, t, n = !1) {
	let r = lm.safeParse(t);
	r.success || Q("RUN_STATE_INVALID", "The portable run transition would produce invalid state."), Buffer.byteLength(JSON.stringify(r.data), "utf8") > 31457280 && Q("RUN_TOO_LARGE", "The portable run record exceeds the 30 MiB safety limit."), await fh(bh(e, t.id), r.data, n);
}
async function Ch(t) {
	t && i(t) || Q("BUNDLE_PATH_INVALID", "Provide an absolute bundle file path.");
	let n;
	try {
		n = await g(t, e.O_RDONLY | e.O_NOFOLLOW);
	} catch (e) {
		throw ah(e, "ELOOP") && Q("BUNDLE_INVALID", "The bundle must not be a symbolic link."), e;
	}
	try {
		let e = await n.stat();
		(!e.isFile() || e.size > 31457280) && Q("BUNDLE_INVALID", "The bundle is not a regular file or exceeds the size limit.");
		let t = Buffer.alloc(e.size + 1), r = 0;
		for (; r < t.length;) {
			let { bytesRead: e } = await n.read(t, r, t.length - r, r);
			if (e === 0) break;
			r += e;
		}
		let i = await n.stat();
		(r !== e.size || i.size !== e.size || i.mtimeMs !== e.mtimeMs) && Q("BUNDLE_INVALID", "The bundle changed while being read; inspect it again.");
		let a = Fp(JSON.parse(t.subarray(0, r).toString("utf8")));
		return a.chain.steps.length > 1e3 && Q("CHAIN_TOO_LARGE", `Portable chains are limited to ${String(am)} steps.`), a;
	} finally {
		await n.close();
	}
}
async function wh(e, t) {
	let n = [];
	for (let r of e.skills) {
		let e = null;
		if (t !== null) {
			let n = a(t, ".agents", "skills", r.directory);
			try {
				let t = await m(n);
				e = t.isDirectory() && !t.isSymbolicLink() && await y(n) === n ? await lh(n) : "unsafe";
			} catch (e) {
				if (!ah(e, "ENOENT")) throw e;
			}
		}
		n.push({
			name: r.name,
			directory: r.directory,
			files: r.files.map((e) => ({
				path: e.path,
				bytes: Mp(e.content).length,
				executable: e.executable
			})),
			skillMarkdown: Buffer.from(r.files.find((e) => e.path === "SKILL.md").content, "base64").toString("utf8"),
			existingFingerprint: e,
			bundledFingerprint: eh(r.files)
		});
	}
	let r = e.version === 2 ? await Promise.all(e.agents.map(async (e) => {
		let n = null;
		if (t !== null) {
			let r = e.harness === "opencode" ? ".opencode/agents" : ".github/agents", i = a(t, r, e.agentPath);
			try {
				let e = await m(i);
				n = e.isFile() && !e.isSymbolicLink() && await y(i) === i ? $m((await ch(i, Sp)).content) : "unsafe";
			} catch (e) {
				if (!ah(e, "ENOENT")) throw e;
			}
		}
		return {
			name: e.name,
			harness: e.harness,
			agentPath: e.agentPath,
			fingerprint: e.fingerprint,
			content: Mp(e.content).toString("utf8"),
			existingFingerprint: n
		};
	})) : [], i = $m(JSON.stringify(e)), o = null;
	if (t !== null) {
		let e = await x(t, { bigint: !0 });
		e.isDirectory() && await y(t) === t || Q("PROJECT_INVALID", "The inspected project is no longer a canonical directory."), o = $m(JSON.stringify({
			version: 1,
			project: t,
			projectDevice: String(e.dev),
			projectInode: String(e.ino),
			bundleFingerprint: i,
			skills: n.map(({ name: e, directory: t, existingFingerprint: n }) => ({
				name: e,
				directory: t,
				existingFingerprint: n
			})),
			agents: r.map(({ harness: e, agentPath: t, existingFingerprint: n }) => ({
				harness: e,
				agentPath: t,
				existingFingerprint: n
			}))
		}));
	}
	return {
		ok: !0,
		chain: e.chain,
		bundleFingerprint: i,
		skills: n,
		agents: r,
		reviewDigest: o
	};
}
async function Th(e) {
	if (e.command === "inspect") return wh(await Ch(e.bundlePath), e.projectPath ? await oh(e.projectPath) : null);
	e.projectPath && i(e.projectPath) || Q("PROJECT_INVALID", "Provide an absolute project path.");
	let t = await oh(e.projectPath), n = await xh(e.input);
	if (e.command === "prepare") {
		e.bundlePath && i(e.bundlePath) || Q("BUNDLE_PATH_INVALID", "Provide an absolute bundle file path."), n.installConfirmed !== !0 && Q("INSTALL_CONFIRMATION_REQUIRED", "Review and explicitly confirm package installation first."), typeof n.reviewDigest == "string" && /^[a-f0-9]{64}$/.test(n.reviewDigest) || Q("REVIEW_REQUIRED", "Inspect the bundle and project, then provide the review digest with installation approval.");
		let r = await Ch(e.bundlePath), a = Pp(r);
		a.agent !== void 0 && Q("NATIVE_AGENT_REQUIRES_LOOM", "This bundle selects a harness-native agent. The portable current-conversation runner cannot switch agents; import the bundle into Skill Loom to run it with the selected agent.");
		let o = nh(r, n.inputs);
		for (let e = 0; e < r.chain.steps.length; e += 1) Buffer.byteLength(rh(r, e, o), "utf8") > Ym && Q("INSTRUCTION_TOO_LARGE", "Resolved step instructions are limited to 64 KiB.");
		let s = n.progression === "agent" ? "agent" : n.progression === "supervised" ? "supervised" : null;
		s === null && Q("PROGRESSION_INVALID", "Choose supervised or agent progression."), s === "agent" && n.progressionConfirmed !== !0 && Q("PROGRESSION_CONFIRMATION_REQUIRED", "Agent-driven progression needs explicit consent.");
		let c = n.actualHost === "copilot" || n.actualHost === "opencode" || n.actualHost === "other" ? n.actualHost : null;
		c === null && Q("HOST_INVALID", "Identify the current host as copilot, opencode, or other.");
		let l = n.hostSwitchConfirmed === !0;
		r.chain.harness !== c && !l && Q("HOST_SWITCH_CONFIRMATION_REQUIRED", "The current host differs from the bundle harness; explicitly confirm compatibility review.");
		let u = n.sessionDecision;
		(typeof u != "object" || !u || Array.isArray(u)) && Q("SESSION_DECISION_REQUIRED", "Describe the verified host session mechanism before preparation.");
		let f = u, p = lm.shape.sessionDecision.safeParse(f);
		p.success && p.data.requested === r.chain.sessionMode || Q("SESSION_DECISION_INVALID", "The session decision must match the bundle and name an actual host mechanism."), (r.chain.sessionMode === "fresh" && p.data.mechanism === "current-conversation" || r.chain.sessionMode === "fork" && p.data.mechanism === "handoff") && p.data.confirmed !== !0 && Q("SESSION_CONFIRMATION_REQUIRED", "A non-native session approximation requires explicit consent."), r.chain.sessionMode === "shared" && p.data.mechanism !== "current-conversation" && Q("SESSION_DECISION_INVALID", "A shared chain must use the current host conversation."), r.chain.sessionMode === "fresh" && !["isolated-worker", "current-conversation"].includes(p.data.mechanism) && Q("SESSION_DECISION_INVALID", "Fresh mode needs a verified isolated worker or an explicitly accepted shared approximation."), r.chain.sessionMode === "fork" && !["native-fork", "handoff"].includes(p.data.mechanism) && Q("SESSION_DECISION_INVALID", "Fork mode needs a verified native fork or an explicitly accepted handoff."), n.installConfirmed !== !0 && Q("INSTALL_CONFIRMATION_REQUIRED", "Review and explicitly confirm package installation first.");
		let m = n.reuseSkills === void 0 ? [] : n.reuseSkills;
		(!Array.isArray(m) || m.some((e) => typeof e != "string")) && Q("REUSE_INVALID", "Reuse choices must be a list of skill names."), (await wh(r, t)).reviewDigest !== n.reviewDigest && Q("REVIEW_STALE", "The bundle, project, or existing package state changed since inspection; review it again."), process.platform === "win32" && r.skills.some((e) => e.files.some((e) => e.executable)) && Q("EXECUTABLE_MODES_UNSUPPORTED", "Windows cannot yet preserve executable modes when installing or reusing bundle skills.");
		let h = await dh(t), g = d();
		return qm(t, "portable", g, () => hh(h, async () => {
			await vh(h, t);
			let e = await wh(r, t);
			e.reviewDigest !== n.reviewDigest && Q("REVIEW_STALE", "The bundle, project, or existing package state changed since inspection; review it again.");
			let { installedSkills: i, createdDirectories: u } = await uh(r, t, m, n.differingReuseConfirmed === !0, new Map(e.skills.map((e) => [e.name, e.existingFingerprint]))), d = $(), f = {
				version: 1,
				id: g,
				revision: 1,
				projectPath: t,
				bundleFingerprint: $m(JSON.stringify(r)),
				bundle: r,
				actualHost: c,
				hostSwitchConfirmed: l,
				progression: s,
				progressionConfirmed: n.progressionConfirmed === !0,
				sessionDecision: p.data,
				resolvedInputs: o,
				installedSkills: i,
				status: "ready",
				currentStepIndex: 0,
				resumeRequired: !1,
				steps: a.steps.map((e, t) => ({
					id: e.id,
					index: t,
					attempts: []
				})),
				createdAt: d,
				updatedAt: d
			};
			try {
				await Sh(h, f, !0);
			} catch (e) {
				throw await Promise.all(u.map((e) => b(e, {
					recursive: !0,
					force: !0
				}))), e;
			}
			return {
				ok: !0,
				runId: g,
				revision: f.revision,
				status: f.status,
				installedSkills: i
			};
		}));
	}
	let r = await dh(t);
	e.runId || Q("RUN_ID_INVALID", "Provide a run id.");
	let o = bh(r, e.runId), s = await _h(o, t);
	if (e.command === "status") return {
		ok: !0,
		run: {
			id: s.id,
			revision: s.revision,
			chainName: s.bundle.chain.name,
			bundleFingerprint: s.bundleFingerprint,
			actualHost: s.actualHost,
			progression: s.progression,
			sessionDecision: s.sessionDecision,
			hostSwitchConfirmed: s.hostSwitchConfirmed,
			installedSkills: s.installedSkills,
			status: s.status,
			currentStepIndex: s.currentStepIndex,
			resumeRequired: s.resumeRequired,
			steps: s.steps,
			createdAt: s.createdAt,
			updatedAt: s.updatedAt
		}
	};
	if (e.command === "step") return Jm(t, {
		kind: "portable",
		runId: s.id
	}, () => hh(r, async () => {
		let e = await _h(o, t);
		n.revision !== e.revision && Q("REVISION_CONFLICT", "Portable run state changed; refresh status before acting."), (e.status !== "ready" || e.resumeRequired) && Q("RUN_NOT_READY", "The run is not ready to start another step."), await vh(r, t, e.id), await yh(e, t), e.progression === "supervised" && n.confirmed !== !0 && Q("STEP_CONFIRMATION_REQUIRED", "Confirm this step before execution.");
		let i = e.bundle.chain.steps[e.currentStepIndex], s = e.steps[e.currentStepIndex];
		i && s || Q("RUN_STATE_INVALID", "The current step is missing."), s.attempts.length >= 50 && Q("ATTEMPTS_EXHAUSTED", "A step can have at most 50 attempts."), s.attempts.at(-1)?.status === "running" && Q("STEP_ALREADY_RUNNING", "The current step already has an unresolved attempt.");
		let c = {
			number: s.attempts.length + 1,
			status: "running",
			startedAt: $(),
			finishedAt: null,
			summary: null,
			reason: null
		};
		s.attempts.push(c), e.status = "running", e.revision += 1, e.updatedAt = $(), await Sh(r, e);
		let l = rh(e.bundle, e.currentStepIndex, e.resolvedInputs), u = null;
		if (e.bundle.chain.sessionMode === "fork" && e.sessionDecision.mechanism === "handoff" && e.currentStepIndex > 0) {
			let t = e.bundle.chain.steps[e.currentStepIndex - 1], n = e.steps[e.currentStepIndex - 1]?.attempts.at(-1), r = rh(e.bundle, e.currentStepIndex - 1, e.resolvedInputs);
			u = [
				"Portable handoff (not a native session fork):",
				`Previous step: ${String(e.currentStepIndex)} "${Df(t)}"`,
				`Previous instruction: ${r.slice(0, 2e3)}`,
				`Recorded status: ${n?.status ?? "unknown"}`,
				`Recorded summary: ${(n?.summary ?? "No summary recorded.").slice(0, 4e3)}`
			].join("\n");
		}
		let d = e.installedSkills.find((e) => e.name === ("skillName" in i ? i.skillName : ""));
		return {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			attempt: c.number,
			step: {
				index: e.currentStepIndex,
				count: e.steps.length,
				id: i.id,
				label: Df(i),
				kind: i.kind === "instruction" ? "instruction" : "skill",
				skillName: "skillName" in i ? i.skillName : null,
				skillPath: d ? a(t, ".agents", "skills", d.directory) : null,
				instruction: l,
				handoffNote: u
			},
			progression: e.progression,
			sessionDecision: e.sessionDecision
		};
	}));
	if (e.command === "record") return Jm(t, {
		kind: "portable",
		runId: s.id
	}, () => hh(r, async () => {
		let e = await _h(o, t);
		if (n.revision !== e.revision && Q("REVISION_CONFLICT", "Portable run state changed; refresh status before acting."), n.action === "pause" || n.action === "abort") return e.status !== "ready" && e.status !== "paused" && Q("RUN_ACTION_INVALID", "Pause or abort is only available between steps."), e.status = n.action === "pause" ? "paused" : "aborted", e.revision += 1, e.updatedAt = $(), await Sh(r, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status
		};
		if (n.action === "retry") {
			let t = e.steps[e.currentStepIndex]?.attempts.at(-1);
			return (e.status !== "paused" || t?.status !== "failed") && Q("RETRY_NOT_AVAILABLE", "Retry is available only for the current failed step."), e.status = "ready", e.revision += 1, e.updatedAt = $(), await Sh(r, e), {
				ok: !0,
				runId: e.id,
				revision: e.revision,
				status: e.status
			};
		}
		if (n.action === "skip") {
			let t = e.steps[e.currentStepIndex];
			return e.status === "ready" && t && typeof n.reason == "string" && n.reason.trim() !== "" || Q("SKIP_REASON_REQUIRED", "Skipping a pending step requires a reason."), e.progression === "supervised" && n.confirmed !== !0 && Q("STEP_CONFIRMATION_REQUIRED", "Confirm skipping this step."), t.attempts.push({
				number: t.attempts.length + 1,
				status: "skipped",
				startedAt: $(),
				finishedAt: $(),
				summary: null,
				reason: n.reason.slice(0, 2e3)
			}), e.currentStepIndex += 1, e.status = e.currentStepIndex >= e.steps.length ? "completed" : "ready", e.revision += 1, e.updatedAt = $(), await Sh(r, e), {
				ok: !0,
				runId: e.id,
				revision: e.revision,
				status: e.status
			};
		}
		let i = e.steps[e.currentStepIndex], a = i?.attempts.at(-1);
		i && a && a.status === "running" && e.status === "running" || Q("STEP_NOT_RUNNING", "There is no active step attempt to record.");
		let s = n.outcome;
		s !== "done" && s !== "failed" && s !== "skipped" && Q("OUTCOME_INVALID", "Record done, failed, or skipped."), s === "skipped" && (typeof n.reason != "string" || n.reason.trim() === "") && Q("SKIP_REASON_REQUIRED", "Skipping a step requires a reason."), s === "done" && e.progression === "supervised" && n.confirmed !== !0 && Q("COMPLETION_CONFIRMATION_REQUIRED", "Confirm the step outcome before marking it done.");
		let c = typeof n.summary == "string" ? n.summary : "";
		return Buffer.byteLength(c, "utf8") > 8192 && Q("SUMMARY_TOO_LARGE", "Step summaries are limited to 8 KiB; do not store a transcript."), a.status = s, a.finishedAt = $(), a.summary = c || null, a.reason = s === "skipped" ? n.reason.slice(0, 2e3) : null, s === "failed" ? e.status = "paused" : (e.currentStepIndex += 1, e.status = e.currentStepIndex >= e.steps.length ? "completed" : "ready"), e.revision += 1, e.updatedAt = $(), await Sh(r, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status,
			currentStepIndex: e.currentStepIndex
		};
	}));
	if (e.command === "resume") return Jm(t, {
		kind: "portable",
		runId: s.id
	}, () => hh(r, async () => {
		let e = await _h(o, t);
		if (n.revision !== e.revision && Q("REVISION_CONFLICT", "Portable run state changed; refresh status before acting."), e.status === "paused" && !e.resumeRequired && n.decision === "continue") return e.status = "ready", e.revision += 1, e.updatedAt = $(), await Sh(r, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status
		};
		if (e.status === "running") {
			n.stoppedConfirmed !== !0 && Q("STOP_CONFIRMATION_REQUIRED", "Confirm that the earlier host work has stopped before marking this attempt interrupted.");
			let t = e.steps[e.currentStepIndex]?.attempts.at(-1);
			return t?.status !== "running" && Q("RUN_STATE_INVALID", "The active run has no in-flight attempt."), t.status = "interrupted", t.finishedAt = $(), e.status = "interrupted", e.resumeRequired = !0, e.revision += 1, e.updatedAt = $(), await Sh(r, e), {
				ok: !0,
				runId: e.id,
				revision: e.revision,
				status: e.status,
				decisionRequired: !0
			};
		}
		e.resumeRequired && e.status === "interrupted" || Q("RESUME_NOT_REQUIRED", "This run has no interrupted attempt requiring recovery.");
		let i = n.decision, a = e.steps[e.currentStepIndex]?.attempts.at(-1);
		if (a && a.status === "interrupted" || Q("RUN_STATE_INVALID", "Interrupted attempt record is missing."), i === "retry") a.reason = "User chose to retry an interrupted attempt; earlier side effects may remain.";
		else if (i === "done") {
			e.progression === "supervised" && n.confirmed !== !0 && Q("COMPLETION_CONFIRMATION_REQUIRED", "Confirm the interrupted step outcome before marking it done.");
			let t = typeof n.summary == "string" ? n.summary : "";
			Buffer.byteLength(t, "utf8") > 8192 && Q("SUMMARY_TOO_LARGE", "Step summaries are limited to 8 KiB."), a.status = "done", a.summary = t || null, e.currentStepIndex += 1;
		} else i === "failed" ? a.status = "failed" : Q("RESUME_DECISION_REQUIRED", "Choose retry, done, or failed for the interrupted attempt.");
		return e.resumeRequired = !1, e.status = i === "failed" ? "paused" : e.currentStepIndex >= e.steps.length ? "completed" : "ready", e.revision += 1, e.updatedAt = $(), await Sh(r, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status
		};
	}));
	Q("COMMAND_INVALID", "Unknown portable run command.");
}
// src/portable/cli.ts
var Eh = [
	"inspect",
	"prepare",
	"status",
	"step",
	"record",
	"resume"
];
function Dh(e) {
	let t = e[0];
	if (!Eh.includes(t)) throw new Qm("USAGE", `Usage: loom-bundle <${Eh.join("|")}> [--bundle PATH] [--project PATH] [--run-id ID]`);
	let n = { command: t };
	for (let t = 1; t < e.length; t += 1) {
		let r = e[t];
		if (r !== "--bundle" && r !== "--project" && r !== "--run-id") throw new Qm("USAGE", `Unknown option "${r}".`);
		let i = e[t + 1];
		if (i === void 0 || i === "" || i.startsWith("--")) throw new Qm("USAGE", `Option "${r}" needs a value.`);
		t += 1, r === "--bundle" && (n.bundlePath = i), r === "--project" && (n.projectPath = i), r === "--run-id" && (n.runId = i);
	}
	if (n.command !== "inspect" && n.projectPath === void 0) throw new Qm("USAGE", "This command needs --project PATH.");
	if ([
		"status",
		"step",
		"record",
		"resume"
	].includes(n.command) && n.runId === void 0) throw new Qm("USAGE", "This command needs --run-id ID.");
	return n;
}
async function Oh(e = process.argv.slice(2), t = {}) {
	let n = t.stdout ?? process.stdout, r = t.stderr ?? process.stderr;
	try {
		let r = Dh(e), i = r.command === "inspect" ? "" : await kh(t.stdin ?? process.stdin);
		i.trim() !== "" && (r.input = JSON.parse(i));
		let a = await Th(r);
		return n.write(`${JSON.stringify(a)}\n`), 0;
	} catch (e) {
		let t = e instanceof Qm || e instanceof Tp || e instanceof Y || e instanceof Gm || e instanceof Z, n = t ? e.code : e instanceof SyntaxError ? "JSON_INVALID" : "REQUEST_FAILED", i = t ? e.message : e instanceof SyntaxError ? "Structured helper input is not valid JSON." : "The portable helper could not complete the request. Check file permissions and retry.";
		return r.write(`${JSON.stringify({
			ok: !1,
			error: {
				code: n,
				message: i
			}
		})}\n`), 1;
	}
}
async function kh(e) {
	if (e === void 0 || "isTTY" in e && e.isTTY === !0) return "";
	let t = [], n = 0;
	for await (let r of e) {
		let e = Buffer.isBuffer(r) ? r : Buffer.from(String(r));
		if (n += e.length, n > 8388608) throw new Qm("REQUEST_TOO_LARGE", "Structured helper input is limited to 8 MiB.");
		t.push(e);
	}
	return Buffer.concat(t).toString("utf8");
}
function Ah() {
	let e = process.argv[1];
	if (e === void 0 || !["loom-bundle.mjs", "cli.js"].includes(n(e))) return !1;
	try {
		return t(s(e)) === t(l(import.meta.url));
	} catch {
		return !1;
	}
}
Ah() && Oh().then((e) => {
	e !== 0 && (process.exitCode = e);
});
export { Dh as parsePortableArgs, Oh as runPortableCli };
