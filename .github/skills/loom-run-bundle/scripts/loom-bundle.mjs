#!/usr/bin/env node
import { basename as e, dirname as t, isAbsolute as n, join as r, relative as i, sep as a } from "node:path";
import { createHash as o, randomUUID as s } from "node:crypto";
import { constants as c } from "node:fs";
import { chmod as l, link as u, lstat as d, mkdir as f, open as p, readFile as m, readdir as h, realpath as g, rename as _, rm as v, stat as y, unlink as ee } from "node:fs/promises";
// node_modules/zod/v4/core/util.js
function b(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return Object.entries(e).filter(([e, n]) => t.indexOf(+e) === -1).map(([e, t]) => t);
}
function x(e, t = "|") {
	return e.map((e) => we(e)).join(t);
}
function te(e, t) {
	return typeof t == "bigint" ? t.toString() : t;
}
var ne = class {
	constructor(e) {
		this._getter = e, this._value = void 0;
	}
	get value() {
		let e = this._getter;
		return e !== void 0 && (this._value = e(), this._getter = void 0), this._value;
	}
};
function re(e) {
	return new ne(e);
}
function ie(e) {
	return e == null;
}
function ae(e) {
	let t = +!!e.startsWith("^"), n = e.endsWith("$") ? e.length - 1 : e.length;
	return e.slice(t, n);
}
function oe(e, t) {
	let n = e / t, r = Math.round(n), i = 4 * 2 ** -52 * Math.max(Math.abs(n), 1);
	return Math.abs(n - r) < i ? 0 : n - r;
}
function se(e, t, n) {
	Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
}
function ce(e) {
	let t = Object.getOwnPropertyDescriptor(e, "shape");
	return t?.get ? t.get.raw : t?.value;
}
function le(e) {
	return ce(e._zod.def) ?? e._zod.def.shape;
}
function ue(e, t, n) {
	Object.defineProperty(e, t, {
		get() {
			let e = n();
			return se(this, t, e), e;
		},
		enumerable: !0,
		configurable: !0
	});
}
function de(e, t, n) {
	t in e ? se(e, t, n) : e[t] = n;
}
function fe(e, t, n, r) {
	let i = le(t);
	for (let a of n) {
		let n = Object.getOwnPropertyDescriptor(i, a);
		n.enumerable && (n.get ? ue(e, a, () => {
			let e = t._zod.def.shape[a];
			return r ? r(e, a) : e;
		}) : de(e, a, r ? r(n.value, a) : n.value));
	}
}
function pe(e, t) {
	for (let n of Reflect.ownKeys(t)) {
		let r = Object.getOwnPropertyDescriptor(t, n);
		r.enumerable && (r.get ? ue(e, n, () => t[n]) : de(e, n, r.value));
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
function me(e) {
	return JSON.stringify(e);
}
function he(e) {
	return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var ge = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {};
function _e(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var ve = /* @__PURE__*/ re(() => {
	if (E.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
	try {
		return Function(""), !0;
	} catch {
		return !1;
	}
});
function ye(e) {
	if (_e(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0 || typeof t != "function") return !0;
	let n = t.prototype;
	return _e(n) !== !1 && Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") !== !1;
}
function be(e) {
	return ye(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
var xe = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function Se(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Ce(e, t, n) {
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
function we(e) {
	return typeof e == "bigint" ? e.toString() + "n" : typeof e == "string" ? `"${e}"` : `${e}`;
}
function Te(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin !== void 0 && e[t]._zod.optout === "optional");
}
var Ee = {
	safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}, De = {
	int64: [/* @__PURE__*/ BigInt("-9223372036854775808"), /* @__PURE__*/ BigInt("9223372036854775807")],
	uint64: [/* @__PURE__*/ BigInt(0), /* @__PURE__*/ BigInt("18446744073709551615")]
};
function Oe(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".pick() cannot be used on object schemas containing refinements");
	let i = {};
	return fe(i, e, ke(e, t)), Ce(e, S(n, {
		shape: i,
		checks: []
	}));
}
function ke(e, t) {
	let n = le(e), r = [];
	for (let e of Reflect.ownKeys(t)) {
		if (!Object.getOwnPropertyDescriptor(n, e)?.enumerable) throw Error(`Unrecognized key: "${String(e)}"`);
		t[e] && r.push(e);
	}
	return r;
}
function Ae(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".omit() cannot be used on object schemas containing refinements");
	let i = new Set(ke(e, t)), a = {};
	return fe(a, e, Reflect.ownKeys(le(e)).filter((e) => !i.has(e))), Ce(e, S(n, {
		shape: a,
		checks: []
	}));
}
function je(e, t) {
	if (!ye(t)) throw Error("Invalid input to extend: expected a plain object");
	let n = e._zod.def.checks;
	if (n && n.length > 0) {
		let n = le(e);
		for (let e of Reflect.ownKeys(t)) if (Object.getOwnPropertyDescriptor(n, e) !== void 0) throw Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return Ce(e, S(e._zod.def, { shape: Me(e, t) }));
}
function Me(e, t) {
	let n = {};
	return fe(n, e, Reflect.ownKeys(le(e))), pe(n, t), n;
}
function Ne(e, t) {
	if (!ye(t)) throw Error("Invalid input to safeExtend: expected a plain object");
	return Ce(e, S(e._zod.def, { shape: Me(e, t) }));
}
function Pe(e, t) {
	if (!t?._zod?.def) throw Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
	if (e._zod.def.checks?.length) throw Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	let n = {};
	return fe(n, e, Reflect.ownKeys(le(e))), fe(n, t, Reflect.ownKeys(le(t))), Ce(e, S(e._zod.def, {
		shape: n,
		get catchall() {
			return t._zod.def.catchall;
		},
		checks: t._zod.def.checks ?? []
	}));
}
function Fe(e, t, n, r = "partial") {
	let i = t._zod.def.checks;
	if (i && i.length > 0) throw Error(`.${r}() cannot be used on object schemas containing refinements`);
	let a = n ? new Set(ke(t, n)) : void 0, o = {};
	return fe(o, t, Reflect.ownKeys(le(t)), e && ((t, n) => a && !a.has(n) ? t : new e({
		type: "optional",
		innerType: t
	}))), Ce(t, S(t._zod.def, {
		shape: o,
		checks: []
	}));
}
function Ie(e, t, n) {
	let r = n ? new Set(ke(t, n)) : void 0, i = {};
	return fe(i, t, Reflect.ownKeys(le(t)), (t, n) => r && !r.has(n) ? t : new e({
		type: "nonoptional",
		innerType: t
	})), Ce(t, S(t._zod.def, { shape: i }));
}
function Le(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
	return !1;
}
function Re(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
	return !1;
}
function ze(e, t) {
	return t.map((t) => {
		var n;
		return (n = t).path ?? (n.path = []), t.path.unshift(e), t;
	});
}
function Be(e) {
	return typeof e == "string" ? e : e?.message;
}
function Ve(e) {
	let t = [];
	for (let n of e ?? []) {
		let e = n._zod.def;
		if (!/_(length|size)$|_equals$/.test(e.check)) break;
		let r = e.maximum ?? e.length ?? e.size;
		r >= 0 && t.push([r, n]);
	}
	return t;
}
function He(e, t, n) {
	var r;
	for (let i = t; i < e.length; i++) (r = e[i]).schema ?? (r.schema = n);
}
function Ue(e, t, n) {
	var r;
	let i = e.inst?._zod?.traits;
	i?.has("$ZodType") && (i.has("$ZodCheck") ? (r = e).schema ?? (r.schema = e.inst) : e.schema = e.inst);
	let a = e.schema === e.inst ? void 0 : e.schema?._zod.def?.error, o = e.message ? e.message : Be(e.inst?._zod.def?.error?.(e)) ?? Be(a?.(e)) ?? Be(t?.error?.(e)) ?? Be(n.customError?.(e)) ?? Be(n.localeError?.(e)) ?? "Invalid input", s = {};
	for (let t of Object.keys(e)) t !== "inst" && t !== "schema" && t !== "continue" && t !== "input" && t !== "__proto__" && (s[t] = e[t]);
	return s.path ??= [], s.message = o, t?.reportInput && (s.input = e.input), s;
}
var We = /[\uD800-\uDBFF]/;
function Ge(e) {
	let t = e.length;
	if (!We.test(e)) return t;
	let n = t;
	for (let r = 0; r < t - 1; r++) (e.charCodeAt(r) & 64512) == 55296 && (e.charCodeAt(r + 1) & 64512) == 56320 && (n--, r++);
	return n;
}
function Ke(e) {
	return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function qe(e) {
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
function Je(...e) {
	let [t, n, r] = e;
	return typeof t == "string" ? {
		message: t,
		code: "custom",
		input: n,
		inst: r
	} : { ...t };
}
function Ye(e, t) {
	for (let n in t) {
		let r = Object.getOwnPropertyDescriptor(t, n);
		r.get ? Object.defineProperty(e, n, {
			...r,
			enumerable: !1
		}) : $e(e, n, r.value);
	}
}
function Xe(e, t, n, r = !0) {
	return Object.defineProperty(e, t, {
		configurable: !0,
		writable: !0,
		enumerable: r,
		value: n
	}), n;
}
function Ze(e, t, n) {
	return Xe(e, t, n, !1);
}
/* @__NO_SIDE_EFFECTS__ */
function Qe(e, t) {
	for (let n in e) {
		let r = e[n];
		Object.defineProperty(t, n, {
			configurable: !0,
			enumerable: !0,
			get() {
				return Xe(this, n, r(this));
			},
			set(e) {
				Xe(this, n, e);
			}
		});
	}
	return t;
}
function $e(e, t, n) {
	Object.defineProperty(e, t, {
		configurable: !0,
		get() {
			return this == null ? n : Xe(this, t, n.bind(this));
		},
		set(e) {
			Xe(this, t, e);
		}
	});
}
function et(e, t) {
	let n = Object.getPrototypeOf(e);
	return t in n ? void 0 : n;
}
var tt, nt = !1, rt = {
	configurable: !0,
	get() {
		nt = !0;
	}
};
function w(e, t, n) {
	let r = Object.getPrototypeOf(e._zod);
	t in r && tt !== e._zod ? tt = void 0 : (tt = e._zod, Object.defineProperty(r, t, {
		configurable: !0,
		get() {
			Object.defineProperty(this, t, rt);
			let e = nt;
			nt = !1;
			try {
				let r = n(this);
				return nt ? delete this[t] : Object.defineProperty(this, t, {
					configurable: !0,
					writable: !0,
					value: r
				}), nt ||= e, r;
			} catch (n) {
				throw delete this[t], nt ||= e, n;
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
function it(e, t, n, r) {
	let i = et(e, t);
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
var at = "~constantCatch";
function ot(e) {
	let t = () => e;
	return t[at] = !0, t;
}
// node_modules/zod/v4/core/core.js
var st, ct = {
	value: void 0,
	enumerable: !1
}, lt = "captureStackTrace" in Error ? Error : null;
function ut(e) {
	let t = lt;
	if (t) {
		let n = t.stackTraceLimit;
		if (typeof n == "number") {
			try {
				t.stackTraceLimit = 0;
			} catch {
				return lt = null, new e();
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
			ct.value = new a(r);
			try {
				Object.defineProperty(n, "_zod", ct);
			} finally {
				ct.value = void 0;
			}
		} else if (n._zod.traits.has(e)) return;
		if (n._zod.traits.add(e), t(n, r), s) {
			let e = Object.getPrototypeOf(n), t = n._zod.constr.prototype, r = e;
			for (; r && r !== t;) r = Object.getPrototypeOf(r);
			let i = r ?? e;
			s.has(i) || (s.add(i), Ye(i, o));
		}
		let i = d.prototype;
		for (let e in i) Object.prototype.hasOwnProperty.call(i, e) && (e in n || (n[e] = i[e].bind(n)));
	}
	let l = r?.Parent ?? Object;
	class u extends l {}
	Object.defineProperty(u, "name", { value: e });
	function d(e) {
		let t = r?.Parent ? ut(u) : this;
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
var dt = class extends Error {
	constructor() {
		super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
	}
}, ft = class extends Error {
	constructor(e) {
		super(`Encountered unidirectional transform during encode: ${e}`), this.name = "ZodEncodeError";
	}
};
(st = globalThis).__zod_globalConfig ?? (st.__zod_globalConfig = {});
var E = globalThis.__zod_globalConfig;
function pt(e) {
	return e && Object.assign(E, e), E;
}
// node_modules/zod/v4/core/errors.js
function mt() {
	let e = this._zod;
	return e.message ??= JSON.stringify(e.def, te, 2), e.message;
}
function ht(e) {
	this._zod.message = e;
}
var gt = {
	get: mt,
	set: ht,
	enumerable: !0,
	configurable: !0
}, _t = {
	value: void 0,
	enumerable: !1
}, vt = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]), yt = /* @__PURE__ */ T("$ZodError", (e, t) => {
	e.name = "$ZodError", _t.value = t, Object.defineProperty(e, "issues", _t), _t.value = void 0, Object.defineProperty(e, "message", gt);
	let n = Object.getPrototypeOf(e);
	vt.has(n) || (vt.add(n), Object.defineProperty(n, "toString", {
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
function bt(e, t, n) {
	return Object.prototype.hasOwnProperty.call(e, t) || (t === "__proto__" ? Object.defineProperty(e, t, {
		value: n(),
		writable: !0,
		enumerable: !0,
		configurable: !0
	}) : e[t] = n()), e[t];
}
function xt(e, t = (e) => e.message) {
	let n = {}, r = [];
	for (let i of e.issues) i.path.length > 0 ? bt(n, i.path[0], () => []).push(t(i)) : r.push(t(i));
	return {
		formErrors: r,
		fieldErrors: n
	};
}
function St(e, t = (e) => e.message) {
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
function Ct(e, t) {
	return {
		callee: t?.callee ?? e,
		Err: t?.Err
	};
}
var wt = (e) => {
	let t = (n, r, i, a) => {
		let o = i ? {
			...i,
			async: !1
		} : { async: !1 }, s = n._zod.run({
			value: r,
			issues: []
		}, o);
		if (s instanceof Promise) throw new dt();
		if (s.issues.length) {
			let n = new ((a?.Err) ?? e)(s.issues.map((e) => Ue(e, o, pt())));
			throw ge(n, a?.callee ?? t), n;
		}
		return s.value;
	};
	return t;
}, Tt = (e) => {
	let t = async (n, r, i, a) => {
		let o = i ? {
			...i,
			async: !0
		} : { async: !0 }, s = n._zod.run({
			value: r,
			issues: []
		}, o);
		if (s instanceof Promise && (s = await s), s.issues.length) {
			let n = new ((a?.Err) ?? e)(s.issues.map((e) => Ue(e, o, pt())));
			throw ge(n, a?.callee ?? t), n;
		}
		return s.value;
	};
	return t;
}, Et = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		async: !1
	} : { async: !1 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	if (a instanceof Promise) throw new dt();
	return a.issues.length ? Dt(e, a.issues, i) : {
		success: !0,
		data: a.value
	};
};
function Dt(e, t, n) {
	let r;
	return {
		success: !1,
		get error() {
			return r || (r = new e(t.map((e) => Ue(e, n, pt()))), t = void 0, n = void 0), r;
		},
		set error(e) {
			r = e, t = void 0, n = void 0;
		}
	};
}
var Ot = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		async: !0
	} : { async: !0 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	return a instanceof Promise && (a = await a), a.issues.length ? Dt(e, a.issues, i) : {
		success: !0,
		data: a.value
	};
}, kt = /* @__PURE__ */ Symbol.for("zod.compile.invalid"), At = /* @__PURE__ */ Symbol.for("zod.compile.fallback"), jt = ((e, t, n) => {
	let r = e._zod.bag.validator;
	if (r !== void 0) {
		if (r(t) !== kt) return !0;
		if (r.definite === !0 && n === void 0) return !1;
	}
	return Mt(e, t, n);
});
function Mt(e, t, n) {
	let r = n ? {
		...n,
		async: !1,
		abortEarly: !0
	} : {
		async: !1,
		abortEarly: !0
	}, i = e._zod.bag.fallbackRun, a;
	if (i ? (r[At] = !0, a = i({
		value: t,
		issues: []
	}, r)) : a = e._zod.run({
		value: t,
		issues: []
	}, r), a instanceof Promise) throw new dt();
	return a.issues.length === 0;
}
var Nt = async (e, t, n) => {
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
}, Pt = (e) => {
	let t = wt(e), n = (e, r, i, a) => {
		let o = i ? {
			...i,
			direction: "backward"
		} : { direction: "backward" };
		return t(e, r, o, Ct(n, a));
	};
	return n;
}, Ft = (e) => {
	let t = wt(e), n = (e, r, i, a) => t(e, r, i, Ct(n, a));
	return n;
}, It = (e) => {
	let t = Tt(e), n = async (e, r, i, a) => {
		let o = i ? {
			...i,
			direction: "backward"
		} : { direction: "backward" };
		return await t(e, r, o, Ct(n, a));
	};
	return n;
}, Lt = (e) => {
	let t = Tt(e), n = async (e, r, i, a) => await t(e, r, i, Ct(n, a));
	return n;
}, Rt = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return Et(e)(t, n, i);
}, zt = (e) => (t, n, r) => Et(e)(t, n, r), Bt = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return Ot(e)(t, n, i);
}, Vt = (e) => async (t, n, r) => Ot(e)(t, n, r), Ht = /^[cC][0-9a-z]{6,}$/, Ut = /^[0-9a-z]+$/, Wt = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/, Gt = /^[0-9a-vA-V]{20}$/, Kt = /^[A-Za-z0-9]{27}$/, qt = /^[a-zA-Z0-9_-]{21}$/;
function Jt(e) {
	return RegExp(`^[a-zA-Z0-9_-]{${e}}$`);
}
var Yt = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, Xt = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, Zt = (e) => e ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, Qt = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, $t = "^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$";
function en() {
	return new RegExp($t, "u");
}
var tn = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, nn = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, rn = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, an = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, on = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, sn = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/, cn = /^https?$/, ln = /^\+[1-9]\d{6,14}$/, un = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
function dn(e) {
	return RegExp(`^${e}$`);
}
var fn = /*@__PURE__*/ dn(un);
function pn(e) {
	let t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
	return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : e.seconds ? `${t}:[0-5]\\d(?:\\.\\d+)?` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function mn(e) {
	return RegExp(`^${pn(e)}$`);
}
function hn(e) {
	let t = ["Z"];
	e.offset && t.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
	let n = `${pn({
		precision: e.precision,
		seconds: !0
	})}(?:${t.join("|")})`, r = e.local ? `${n}|${pn({ precision: e.precision })}` : n;
	return RegExp(`^${un}T(?:${r})$`);
}
var gn = /^[\s\S]{0,}$/, _n = /^-?\d+$/, vn = /^-?\d+(?:\.\d+)?$/, yn = /^(?:true|false)$/i, bn = /^[^A-Z]*$/, xn = /^[^a-z]*$/, D = /*@__PURE__*/ T("$ZodCheck", (e, t) => {
	var n;
	e._zod ??= {}, e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), Sn = (e) => {
	let t = e.value;
	return !ie(t) && t.length !== void 0;
}, Cn = {
	number: "number",
	bigint: "bigint",
	object: "date"
}, wn = /*@__PURE__*/ T("$ZodCheckLessThan", (e, t) => {
	D.init(e, t);
	let n = Cn[typeof t.value];
	e._zod.check = (r) => {
		(t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
			origin: Cn[typeof r.value] ?? n,
			code: "too_big",
			maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), Tn = /*@__PURE__*/ T("$ZodCheckGreaterThan", (e, t) => {
	D.init(e, t);
	let n = Cn[typeof t.value];
	e._zod.check = (r) => {
		(t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
			origin: Cn[typeof r.value] ?? n,
			code: "too_small",
			minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), En = /*@__PURE__*/ T("$ZodCheckMultipleOf", (e, t) => {
	D.init(e, t), e._zod.check = (n) => {
		if (typeof n.value != typeof t.value) throw Error("Cannot mix number and bigint in multiple_of check.");
		(typeof n.value == "bigint" ? t.value !== BigInt(0) && n.value % t.value === BigInt(0) : oe(n.value, t.value) === 0) || n.issues.push({
			origin: typeof n.value,
			code: "not_multiple_of",
			divisor: t.value,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Dn = /*@__PURE__*/ T("$ZodCheckNumberFormat", (e, t) => {
	D.init(e, t), t.format = t.format || "float64";
	let n = t.format?.includes("int"), r = n ? "int" : "number", [i, a] = Ee[t.format];
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
}), On = /*@__PURE__*/ T("$ZodCheckMaxLength", (e, t) => {
	var n;
	D.init(e, t), (n = e._zod.def).when ?? (n.when = Sn), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if ((typeof r == "string" && i > t.maximum ? Ge(r) : i) <= t.maximum) return;
		let a = Ke(r);
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
}), kn = /*@__PURE__*/ T("$ZodCheckMinLength", (e, t) => {
	var n;
	D.init(e, t), (n = e._zod.def).when ?? (n.when = Sn), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if ((typeof r == "string" && i >= t.minimum && i < t.minimum * 2 ? Ge(r) : i) >= t.minimum) return;
		let a = Ke(r);
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
}), An = /*@__PURE__*/ T("$ZodCheckLengthEquals", (e, t) => {
	var n;
	D.init(e, t), (n = e._zod.def).when ?? (n.when = Sn), e._zod.check = (n) => {
		let r = n.value, i = r.length, a = typeof r == "string" && i >= t.length && i <= t.length * 2 ? Ge(r) : i;
		if (a === t.length) return;
		let o = Ke(r), s = a > t.length;
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
}), jn = /*@__PURE__*/ T("$ZodCheckStringFormat", (e, t) => {
	var n, r;
	D.init(e, t), t.pattern ? (n = e._zod).check ?? (n.check = (n) => {
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
}), Mn = /*@__PURE__*/ T("$ZodCheckRegex", (e, t) => {
	jn.init(e, t), e._zod.check = (n) => {
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
}), Nn = /*@__PURE__*/ T("$ZodCheckLowerCase", (e, t) => {
	t.pattern ??= bn, jn.init(e, t);
}), Pn = /*@__PURE__*/ T("$ZodCheckUpperCase", (e, t) => {
	t.pattern ??= xn, jn.init(e, t);
}), Fn = /*@__PURE__*/ T("$ZodCheckIncludes", (e, t) => {
	D.init(e, t);
	let n = Se(t.includes);
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
}), In = /*@__PURE__*/ T("$ZodCheckStartsWith", (e, t) => {
	D.init(e, t);
	let n = RegExp(`^${Se(t.prefix)}.*`);
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
}), Ln = /*@__PURE__*/ T("$ZodCheckEndsWith", (e, t) => {
	D.init(e, t);
	let n = RegExp(`.*${Se(t.suffix)}$`);
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
}), Rn = /*@__PURE__*/ T("$ZodCheckOverwrite", (e, t) => {
	D.init(e, t), e._zod.check = (e) => {
		e.value = t.tx(e.value);
	};
}), zn = class {
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
}, Bn = {
	major: 4,
	minor: 6,
	patch: 7
}, O = /*@__PURE__*/ T("$ZodType", (e, t) => {
	var n;
	e ??= {}, e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = Bn;
	let r = e._zod.def.checks, i = e._zod.traits.has("$ZodCheck") ? [e, ...r ?? []] : r?.length ? [...r] : [];
	for (let t of i) for (let n of t._zod.onattach) n(e);
	if (i.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
		e._zod.run = e._zod.parse;
	});
	else {
		let t = (t, n, r) => {
			if (t.memo) return t;
			let i = Le(t), a;
			for (let o of n) {
				if (o._zod.def.when) {
					if (Re(t) || !o._zod.def.when(t)) continue;
				} else if (i) continue;
				let n = t.issues.length, s = o._zod.check(t);
				if (s instanceof Promise && r?.async === !1) throw new dt();
				if (a || s instanceof Promise) a = (a ?? Promise.resolve()).then(async () => {
					await s, t.issues.length !== n && (He(t.issues, n, e), i ||= Le(t, n));
				});
				else {
					if (t.issues.length === n) continue;
					He(t.issues, n, e), i ||= Le(t, n);
				}
			}
			return a ? a.then(() => t) : t;
		}, n = (n, r, a) => {
			if (Le(n)) return n.aborted = !0, n;
			let o = t(r, i, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new dt();
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
				if (a.async === !1) throw new dt();
				return o.then((e) => t(e, i, a));
			}
			return t(o, i, a);
		};
	}
}, {
	get "~standard"() {
		return Ze(this, "~standard", Un(this));
	},
	set "~standard"(e) {
		Xe(this, "~standard", e);
	}
}), Vn = (e, t) => e.issues.length ? { issues: e.issues.map((e) => Ue(e, t, pt())) } : { value: e.value };
async function Hn(e, t) {
	let n = { async: !0 };
	return Vn(await e._zod.run({
		value: t,
		issues: []
	}, n), n);
}
function Un(e) {
	return {
		validate: (t) => {
			let n = { async: !1 };
			try {
				let r = e._zod.run({
					value: t,
					issues: []
				}, n);
				if (!(r instanceof Promise)) return Vn(r, n);
			} catch {}
			return Hn(e, t);
		},
		vendor: "zod",
		version: 1
	};
}
var Wn = /*@__PURE__*/ T("$ZodString", (e, t) => {
	O.init(e, t), e._zod.pattern = t.pattern ?? gn, e._zod.parse = (n, r) => {
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
}), k = /*@__PURE__*/ T("$ZodStringFormat", (e, t) => {
	jn.init(e, t), Wn.init(e, t);
}), Gn = /*@__PURE__*/ T("$ZodGUID", (e, t) => {
	t.pattern ??= Xt, k.init(e, t);
}), Kn = /*@__PURE__*/ T("$ZodUUID", (e, t) => {
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
		t.pattern ??= Zt(e);
	} else t.pattern ??= Zt();
	k.init(e, t);
}), qn = /*@__PURE__*/ T("$ZodEmail", (e, t) => {
	t.pattern ??= Qt, k.init(e, t);
});
function Jn(e) {
	try {
		return typeof URL < "u" && typeof URL.canParse == "function" ? URL.canParse(e) : (new URL(e), !0);
	} catch {
		return !1;
	}
}
function Yn(e, t) {
	return !("normalize" in t) && !("hostname" in t) && !("protocol" in t) ? Jn(e) || 2 : Xn(e, t);
}
function Xn(e, t) {
	if (!t.normalize && t.protocol?.source === cn.source && !/^https?:\/\//i.test(e)) return 1;
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
var Zn = /[\t\n\r]/g;
function Qn(e) {
	return e.replace(Zn, "");
}
function $n(e, t) {
	return t.lastIndex = 0, t.test(e.hostname);
}
function er(e, t) {
	return t.lastIndex = 0, t.test(e.protocol.endsWith(":") ? e.protocol.slice(0, -1) : e.protocol);
}
var tr = /*@__PURE__*/ T("$ZodURL", (e, t) => {
	k.init(e, t), e._zod.check = (n) => {
		try {
			let r = n.value.trim(), i = Yn(r, t);
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
				n.value = Qn(r);
				return;
			}
			t.hostname && !$n(i, t.hostname) && n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: t.hostname.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			}), t.protocol && !er(i, t.protocol) && n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: t.protocol.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			}), n.value = t.normalize ? i.href : Qn(r);
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
}), nr = /*@__PURE__*/ T("$ZodEmoji", (e, t) => {
	t.pattern ??= en(), k.init(e, t);
}), rr = /*@__PURE__*/ T("$ZodNanoID", (e, t) => {
	if (t.length !== void 0 && (!Number.isInteger(t.length) || t.length < 1)) throw Error(`Invalid nanoid length: ${t.length}`);
	t.pattern ??= t.length === void 0 ? qt : Jt(t.length), k.init(e, t);
}), ir = /*@__PURE__*/ T("$ZodCUID", (e, t) => {
	t.pattern ??= Ht, k.init(e, t);
}), ar = /*@__PURE__*/ T("$ZodCUID2", (e, t) => {
	t.pattern ??= Ut, k.init(e, t);
}), or = /*@__PURE__*/ T("$ZodULID", (e, t) => {
	t.pattern ??= Wt, k.init(e, t);
}), sr = /*@__PURE__*/ T("$ZodXID", (e, t) => {
	t.pattern ??= Gt, k.init(e, t);
}), cr = /*@__PURE__*/ T("$ZodKSUID", (e, t) => {
	t.pattern ??= Kt, k.init(e, t);
}), lr = /*@__PURE__*/ T("$ZodISODateTime", (e, t) => {
	t.pattern ??= hn(t), k.init(e, t);
}), ur = /*@__PURE__*/ T("$ZodISODate", (e, t) => {
	t.pattern ??= fn, k.init(e, t);
}), dr = /*@__PURE__*/ T("$ZodISOTime", (e, t) => {
	t.pattern ??= mn(t), k.init(e, t);
}), fr = /*@__PURE__*/ T("$ZodISODuration", (e, t) => {
	t.pattern ??= Yt, k.init(e, t);
}), pr = /*@__PURE__*/ T("$ZodIPv4", (e, t) => {
	t.pattern ??= tn, k.init(e, t);
}), mr = /^[0-9a-fA-F:.]+$/;
function hr(e) {
	return mr.test(e) ? Jn(`http://[${e}]`) : !1;
}
var gr = /*@__PURE__*/ T("$ZodIPv6", (e, t) => {
	t.pattern ??= nn, k.init(e, t), e._zod.check = (n) => {
		hr(n.value) || n.issues.push({
			code: "invalid_format",
			format: "ipv6",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), _r = /*@__PURE__*/ T("$ZodCIDRv4", (e, t) => {
	t.pattern ??= rn, k.init(e, t);
});
function vr(e) {
	let t = e.split("/");
	if (t.length !== 2) return !1;
	let [n, r] = t;
	if (!r) return !1;
	let i = Number(r);
	return `${i}` !== r || i < 0 || i > 128 ? !1 : hr(n);
}
var yr = /*@__PURE__*/ T("$ZodCIDRv6", (e, t) => {
	t.pattern ??= an, k.init(e, t), e._zod.check = (n) => {
		vr(n.value) || n.issues.push({
			code: "invalid_format",
			format: "cidrv6",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
});
function br(e) {
	if (e === "") return !0;
	if (/\s/.test(e) || e.length % 4 != 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var xr = /^[0-9a-zA-Z+/]*={0,2}$/, Sr = /*@__PURE__*/ T("$ZodBase64", (e, t) => {
	t.pattern ??= xr, k.init(e, t), e._zod.check = (n) => {
		br(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Cr = /^[A-Za-z0-9_-]*$/;
function wr(e) {
	if (!Cr.test(e)) return !1;
	let t = e.replace(/[-_]/g, (e) => e === "-" ? "+" : "/");
	return br(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
var Tr = /*@__PURE__*/ T("$ZodBase64URL", (e, t) => {
	t.pattern ??= Cr, k.init(e, t), e._zod.check = (n) => {
		wr(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Er = /*@__PURE__*/ T("$ZodE164", (e, t) => {
	t.pattern ??= ln, k.init(e, t);
});
function Dr(e, t = null) {
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
var Or = /*@__PURE__*/ T("$ZodJWT", (e, t) => {
	k.init(e, t), e._zod.check = (n) => {
		Dr(n.value, t.alg) || n.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), kr = /*@__PURE__*/ T("$ZodNumber", (e, t) => {
	O.init(e, t), e._zod.pattern = vn, e._zod.parse = (n, r) => {
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
}), Ar = /*@__PURE__*/ T("$ZodNumberFormat", (e, t) => {
	Dn.init(e, t), kr.init(e, t);
}), jr = /*@__PURE__*/ T("$ZodBoolean", (e, t) => {
	O.init(e, t), e._zod.pattern = yn, e._zod.parse = (n, r) => {
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
}), Mr = /*@__PURE__*/ T("$ZodUnknown", (e, t) => {
	O.init(e, t), e._zod.parse = (e) => e;
}), Nr = /*@__PURE__*/ T("$ZodNever", (e, t) => {
	O.init(e, t), e._zod.parse = (t, n) => (t.issues.push({
		expected: "never",
		code: "invalid_type",
		input: t.value,
		inst: e
	}), t);
});
function Pr(e, t) {
	let n = Ve(e._zod.def.checks);
	if (!n.length) return;
	let r = Math.min(...n.map((e) => e[0])), i = e._zod.parse;
	e._zod.parse = (n, a) => {
		let o = t(n.value);
		if (o > r && !a?.skipChecks && a?.direction !== "backward") {
			for (let [t, r] of Ve(e._zod.def.checks)) if (o > t && r._zod.def.when(n)) {
				let t = n.issues.length;
				return r._zod.check(n), n.issues[t].continue = !1, He(n.issues, t, e), n;
			}
		}
		return i(n, a);
	};
}
var Fr = (e) => Array.isArray(e) ? e.length : -1;
function Ir(e, t, n) {
	e.issues.length && t.issues.push(...ze(n, e.issues)), t.value[n] = e.value;
}
var Lr = /*@__PURE__*/ T("$ZodArray", (e, t) => {
	O.init(e, t);
	let n = E.memoizer;
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
			if (c instanceof Promise) o.push(c.then((t) => Ir(t, r, e)));
			else if (Ir(c, r, e), s && c.issues.length !== 0 && Le(c)) break;
		}
		return o.length ? Promise.all(o).then(() => r) : r;
	}, Pr(e, Fr);
});
function Rr(e, t, n, r, i, a) {
	let o = n in r, s = a === "optional";
	if (o || !s || i !== "optional") {
		if (e.issues.length) {
			if (i !== void 0 && s && !o) return;
			t.issues.push(...ze(n, e.issues));
		}
		!o && i === void 0 ? e.issues.length || t.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [n]
		}) : e.value === void 0 ? (o || i === "defaulted" && !s) && (t.value[n] = void 0) : t.value[n] = e.value;
	}
}
var zr = [];
function Br(e) {
	let t = Object.keys(e.shape), n = Object.getOwnPropertySymbols(e.shape), r = n.length ? n : zr, i = r.length ? [...t, ...r] : t;
	for (let t of i) if (!e.shape?.[t]?._zod?.traits?.has("$ZodType")) throw Error(`Invalid element at key "${String(t)}": expected a Zod schema`);
	let a = Te(e.shape);
	return {
		...e,
		allKeys: i,
		symbolKeys: r,
		keySet: new Set(t),
		numKeys: t.length,
		optionalKeys: new Set(a)
	};
}
function Vr(e, t, n, r, i, a, o) {
	let s = [], c = i.keySet, l = i.catchall._zod, u = l.def.type, d = l.optin, f = l.optout, p = 0;
	for (let i in t) {
		if (o && n.issues.length !== p) {
			if (Le(n, p)) break;
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
		a instanceof Promise ? e.push(a.then((e) => Rr(e, n, i, t, d, f))) : Rr(a, n, i, t, d, f);
	}
	return s.length && n.issues.push({
		code: "unrecognized_keys",
		keys: s,
		input: t,
		inst: a,
		continue: !0
	}), e.length ? Promise.all(e).then(() => n) : n;
}
var Hr = /*@__PURE__*/ T("$ZodObject", (e, t) => {
	O.init(e, t);
	let n = Object.getOwnPropertyDescriptor(t, "shape"), r = n?.get ? n.get.raw : t.shape ?? {};
	if (r) {
		let e = () => {
			let n = { ...r };
			return Object.defineProperty(t, "shape", { value: n }), e.raw = n, n;
		};
		e.raw = r, Object.defineProperty(t, "shape", { get: e });
	}
	let i = re(() => Br(t));
	w(e, "propValues", (e) => {
		let t = e.def.shape, n = {};
		for (let e in t) {
			let r = t[e]._zod;
			if (r.values) {
				Object.prototype.hasOwnProperty.call(n, e) || se(n, e, /* @__PURE__ */ new Set());
				for (let t of r.values) n[e].add(t);
				r.optin !== void 0 && n[e].add(void 0);
			}
		}
		return n;
	});
	let a = _e, o = t.catchall, s, c = E.memoizer;
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
				if (Le(t, f)) break;
				f = t.issues.length;
			}
			if (e === "__proto__") continue;
			let i = u[e], a = i._zod.optin, o = i._zod.optout, s = i._zod.run({
				value: r[e],
				issues: []
			}, n);
			s instanceof Promise ? l.push(s.then((n) => Rr(n, t, e, r, a, o))) : Rr(s, t, e, r, a, o);
		}
		return o ? Vr(l, r, t, n, i.value, e, d === !0) : l.length ? Promise.all(l).then(() => t) : t;
	};
}), Ur = /*@__PURE__*/ T("$ZodObjectJIT", (e, t) => {
	Hr.init(e, t);
	let n = e._zod.parse, r = re(() => Br(t)), i = E.memoizer, a = (t) => {
		let n = r.value, a = n.symbolKeys, o = new zn(["payload", "ctx"], {
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
			let n = l[e], r = typeof e == "symbol" ? `syms[${a.indexOf(e)}]` : me(e), i = `${r} in input`, u = t[e], d = u?._zod?.optin, f = d !== void 0, p = u?._zod?.optout === "optional";
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
	}, o, s = _e, c = !E.jitless, l = c && ve.value, u = t.catchall, d;
	e._zod.parse = (i, f) => {
		d ??= r.value;
		let p = i.value;
		return s(p) ? c && l && f?.async === !1 && f.jitless !== !0 ? (o ||= a(t.shape), i = o(i, f), u ? Vr([], p, i, f, d, e, f?.abortEarly === !0) : i) : n(i, f) : (i.issues.push({
			expected: "object",
			code: "invalid_type",
			input: p,
			inst: e
		}), i);
	};
});
function Wr(e, t, n, r) {
	for (let n of e) if (n.issues.length === 0) return t.value = n.value, t;
	let i = e.filter((e) => !Le(e));
	return i.length === 1 ? (t.value = i[0].value, i[0]) : (t.issues.push({
		code: "invalid_union",
		input: t.value,
		inst: n,
		errors: e.map((e) => e.issues.map((e) => Ue(e, r, pt())))
	}), t);
}
var Gr = /*@__PURE__*/ T("$ZodUnion", (e, t) => {
	O.init(e, t), w(e, "optin", (e) => e.def.options.some((e) => e._zod.optin === "defaulted") ? "defaulted" : e.def.options.some((e) => e._zod.optin !== void 0) ? "optional" : void 0), w(e, "optout", (e) => e.def.options.some((e) => e._zod.optout === "optional") ? "optional" : void 0), w(e, "values", (e) => {
		if (e.def.options.every((e) => e._zod.values)) return new Set(e.def.options.flatMap((e) => Array.from(e._zod.values)));
	}), w(e, "pattern", (e) => {
		if (e.def.options.every((e) => e._zod.pattern)) {
			let t = e.def.options.map((e) => e._zod.pattern);
			return RegExp(`^(${t.map((e) => ae(e.source)).join("|")})$`);
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
		return a ? Promise.all(o).then((t) => Wr(t, r, e, i)) : Wr(o, r, e, i);
	};
});
function Kr(e) {
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
var qr = /*@__PURE__*/ T("$ZodDiscriminatedUnion", (e, t) => {
	t.inclusive = !1, Gr.init(e, t);
	let n = e._zod.parse;
	w(e, "propValues", (e) => {
		let t = {}, n = 0;
		for (let r of e.def.options) {
			let i = r._zod.propValues;
			if (!i || Object.keys(i).length === 0) throw Error(`Invalid discriminated union option at index "${e.def.options.indexOf(r)}"`);
			i[e.def.discriminator]?.has(void 0) && n++;
			for (let [e, n] of Object.entries(i)) {
				Object.prototype.hasOwnProperty.call(t, e) || se(t, e, /* @__PURE__ */ new Set());
				for (let r of n) t[e].add(r);
			}
		}
		return !e.def.unionFallback && n > 1 && t[e.def.discriminator]?.delete(void 0), t;
	}), t.options.forEach((e, n) => {
		let r = ce(e._zod.def);
		if (r && !Object.prototype.hasOwnProperty.call(r, t.discriminator)) throw Error(`Invalid discriminated union option at index "${n}"`);
	});
	let r = re(() => Kr(t));
	e._zod.parse = (i, a) => {
		let o = i.value;
		if (!_e(o)) return i.issues.push({
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
}), Jr = /*@__PURE__*/ T("$ZodIntersection", (e, t) => {
	O.init(e, t), e._zod.parse = (e, n) => {
		let r = e.value, i = t.left._zod.run({
			value: r,
			issues: []
		}, n), a = t.right._zod.run({
			value: r,
			issues: []
		}, n);
		return i instanceof Promise || a instanceof Promise ? Promise.all([i, a]).then(([t, n]) => Xr(e, t, n)) : Xr(e, i, a);
	};
});
function Yr(e, t) {
	if (e === t || e instanceof Date && t instanceof Date && +e == +t) return {
		valid: !0,
		data: e
	};
	if (ye(e) && ye(t)) {
		let n = Object.keys(t), r = Object.keys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		Object.prototype.hasOwnProperty.call(i, "__proto__") && delete i.__proto__;
		for (let n of r) {
			if (n === "__proto__") continue;
			let r = Yr(e[n], t[n]);
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
			let i = e[r], a = t[r], o = Yr(i, a);
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
function Xr(e, t, n) {
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
	let c = Yr(t.value, n.value);
	if (!c.valid) {
		if (Le(e)) return e;
		throw Error(`Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`);
	}
	return e.value = c.data, e;
}
var Zr = /*@__PURE__*/ T("$ZodRecord", (e, t) => {
	O.init(e, t);
	let n = E.memoizer;
	n?.attach(e), e._zod.parse = (r, i) => {
		let a = r.value;
		if (!ye(a)) return r.issues.push({
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
						issues: s.issues.map((e) => Ue(e, i, pt())),
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
					e.issues.length && r.issues.push(...ze(n, e.issues)), r.value[l] = e.value;
				})) : (u.issues.length && r.issues.push(...ze(n, u.issues)), r.value[l] = u.value);
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
				if (typeof n == "string" && vn.test(n) && l.issues.length) {
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
						issues: l.issues.map((e) => Ue(e, i, pt())),
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
					e.issues.length && r.issues.push(...ze(n, e.issues)), r.value[u] = e.value;
				})) : (d.issues.length && r.issues.push(...ze(n, d.issues)), r.value[u] = d.value);
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
}), Qr = /*@__PURE__*/ T("$ZodEnum", (e, t) => {
	O.init(e, t);
	let n = b(t.entries), r = new Set(n);
	e._zod.values = r, w(e, "pattern", (e) => {
		let t = b(e.def.entries).filter((e) => xe.has(typeof e));
		return RegExp(t.length ? `^(${t.map((e) => Se(e.toString())).join("|")})$` : "^[^\\s\\S]$");
	}), e._zod.parse = (t, i) => {
		let a = t.value;
		return r.has(a) || t.issues.push({
			code: "invalid_value",
			values: n,
			input: a,
			inst: e
		}), t;
	};
}), $r = /*@__PURE__*/ T("$ZodLiteral", (e, t) => {
	O.init(e, t);
	let n = new Set(t.values);
	e._zod.values = n, w(e, "pattern", (e) => {
		let t = e.def.values;
		return RegExp(t.length ? `^(${t.map((e) => typeof e == "string" ? Se(e) : e ? Se(e.toString()) : String(e)).join("|")})$` : "^[^\\s\\S]$");
	}), e._zod.parse = (r, i) => {
		let a = r.value;
		return n.has(a) || r.issues.push({
			code: "invalid_value",
			values: t.values,
			input: a,
			inst: e
		}), r;
	};
}), ei = /*@__PURE__*/ T("$ZodTransform", (e, t) => {
	O.init(e, t), e._zod.optin = "optional", E.memoizer?.guard(e), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new ft(e.constructor.name);
		let i = t.transform(n.value, n);
		if (r.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => (n.value = e, n));
		if (i instanceof Promise) throw new dt();
		return n.value = i, n;
	};
});
function ti(e, t) {
	return e.value = t.issues.length ? void 0 : t.value, e;
}
var ni = /*@__PURE__*/ T("$ZodOptional", (e, t) => {
	O.init(e, t), w(e, "optin", (e) => e.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), e._zod.optout = "optional", w(e, "values", (e) => {
		let t = e.def.innerType._zod.values;
		return t ? /* @__PURE__ */ new Set([...t, void 0]) : void 0;
	}), w(e, "pattern", (e) => {
		let t = e.def.innerType._zod.pattern;
		return t ? RegExp(`^(${ae(t.source)})?$`) : void 0;
	}), e._zod.parse = (e, n) => {
		if (e.value === void 0) {
			if (t.innerType._zod.optin !== "defaulted") return e;
			let r = t.innerType._zod.run({
				value: e.value,
				issues: []
			}, n);
			return r instanceof Promise ? r.then((t) => ti(e, t)) : ti(e, r);
		}
		return t.innerType._zod.run(e, n);
	};
}), ri = /*@__PURE__*/ T("$ZodExactOptional", (e, t) => {
	ni.init(e, t), w(e, "values", (e) => e.def.innerType._zod.values), w(e, "pattern", (e) => e.def.innerType._zod.pattern), e._zod.parse = (e, n) => t.innerType._zod.run(e, n);
}), ii = /*@__PURE__*/ T("$ZodNullable", (e, t) => {
	O.init(e, t), w(e, "optin", (e) => e.def.innerType._zod.optin), w(e, "optout", (e) => e.def.innerType._zod.optout), w(e, "pattern", (e) => {
		let t = e.def.innerType._zod.pattern;
		return t ? RegExp(`^(${ae(t.source)}|null)$`) : void 0;
	}), w(e, "values", (e) => e.def.innerType._zod.values ? /* @__PURE__ */ new Set([...e.def.innerType._zod.values, null]) : void 0), e._zod.parse = (e, n) => e.value === null ? e : t.innerType._zod.run(e, n);
}), ai = /*@__PURE__*/ T("$ZodDefault", (e, t) => {
	O.init(e, t), e._zod.optin = "defaulted", w(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		if (e.value === void 0) return e.value = t.defaultValue, e;
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => oi(e, t)) : oi(r, t);
	};
});
function oi(e, t) {
	return e.value === void 0 && (e.value = t.defaultValue), e;
}
var si = /*@__PURE__*/ T("$ZodPrefault", (e, t) => {
	O.init(e, t), e._zod.optin = "defaulted", w(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => (n.direction === "backward" || e.value === void 0 && (e.value = t.defaultValue), t.innerType._zod.run(e, n));
}), ci = /*@__PURE__*/ T("$ZodNonOptional", (e, t) => {
	O.init(e, t), w(e, "values", (e) => {
		let t = e.def.innerType._zod.values;
		return t ? new Set([...t].filter((e) => e !== void 0)) : void 0;
	}), e._zod.parse = (n, r) => {
		let i = t.innerType._zod.run(n, r);
		return i instanceof Promise ? i.then((t) => li(t, e)) : li(i, e);
	};
});
function li(e, t) {
	return !e.issues.length && e.value === void 0 && e.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: e.value,
		inst: t
	}), e;
}
function ui(e, t, n, r) {
	return t.issues.length ? (e.value = n.catchValue({
		...t,
		value: e.value,
		error: { issues: t.issues.map((e) => Ue(e, r, pt())) },
		input: e.value
	}), e) : (e.value = t.value, t.memo && (e.memo = !0), e);
}
var di = /*@__PURE__*/ T("$ZodCatch", (e, t) => {
	O.init(e, t), w(e, "optin", (e) => e.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), w(e, "optout", (e) => e.def.innerType._zod.optout), w(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run({
			value: e.value,
			issues: []
		}, n);
		return r instanceof Promise ? r.then((r) => ui(e, r, t, n)) : ui(e, r, t, n);
	};
}), fi = /*@__PURE__*/ T("$ZodPipe", (e, t) => {
	O.init(e, t), w(e, "values", (e) => e.def.in._zod.values), w(e, "optin", (e) => e.def.in._zod.optin), w(e, "optout", (e) => e.def.out._zod.optout), w(e, "propValues", (e) => e.def.in._zod.propValues), e._zod.parse = (e, n) => {
		if (n.direction === "backward") {
			let r = t.out._zod.run(e, n);
			return r instanceof Promise ? r.then((e) => pi(e, t.in, n)) : pi(r, t.in, n);
		}
		let r = t.in._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => pi(e, t.out, n)) : pi(r, t.out, n);
	};
});
function pi(e, t, n) {
	return e.issues.some((e) => e.code !== "unrecognized_keys") ? (e.aborted = !0, e) : t._zod.run({
		value: e.value,
		issues: e.issues
	}, n);
}
var mi = /*@__PURE__*/ T("$ZodReadonly", (e, t) => {
	O.init(e, t), w(e, "propValues", (e) => e.def.innerType._zod.propValues), w(e, "values", (e) => e.def.innerType._zod.values), w(e, "optin", (e) => e.def.innerType?._zod?.optin), w(e, "optout", (e) => e.def.innerType?._zod?.optout), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then(hi) : hi(r);
	};
});
function hi(e) {
	return e.memo || (e.value = Object.freeze(e.value)), e;
}
var gi = /*@__PURE__*/ T("$ZodCustom", (e, t) => {
	D.init(e, t), O.init(e, t), e._zod.parse = (e, t) => e, e._zod.check = (n) => {
		let r = n.value, i = t.fn(r);
		if (i instanceof Promise) return i.then((t) => _i(t, n, r, e));
		_i(i, n, r, e);
	};
});
function _i(e, t, n, r) {
	if (!e) {
		let e = {
			code: "custom",
			input: n,
			inst: r,
			path: [...r._zod.def.path ?? []],
			continue: !r._zod.def.abort
		};
		r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Je(e));
	}
}
// node_modules/zod/v4/core/memoizer.js
var vi = class extends Error {
	constructor() {
		super("Cannot parse a reference cycle that closes through a transform"), this.name = "ZodCyclicError";
	}
}, yi = "~memo", bi = [];
function xi(e) {
	return typeof e == "object" && !!e;
}
function Si(e) {
	return e.map((e) => e.path ? {
		...e,
		path: e.path.slice()
	} : { ...e });
}
var Ci = /*@__PURE__*/ new WeakMap(), wi = 0, Ti = 1, Ei = 2;
function Di(e, t, n) {
	let r = Ci.get(e);
	if (r !== void 0) return r ? Ei : wi;
	if (t.has(e)) return Ei;
	t.add(e);
	let i = wi, a = (e) => {
		if (i !== Ei && e?._zod) {
			let r = Di(e, t, n);
			r > i && (i = r);
		}
	}, o = (e, r) => {
		let i = wi;
		for (let a of Reflect.ownKeys(e)) {
			let o = Object.getOwnPropertyDescriptor(e, a);
			if (r && !o.enumerable) continue;
			let s = o.get ? Ti : o.value?._zod ? Di(o.value, t, n) : wi;
			s > i && (i = s);
		}
		return i;
	}, s = (e) => {
		e > i && (i = e);
	}, c = e._zod.def;
	switch (c.type) {
		case "object": {
			let e = ce(c);
			s(e ? o(e, !0) : Ti), a(c.catchall);
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
			s(r ? Di(r, t, !1) : Ti);
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
	return t.delete(e), Oi(e, i);
}
function Oi(e, t) {
	return t !== Ti && Ci.set(e, t === Ei), t;
}
function ki(e, t) {
	let n = e.buckets.get(t);
	return n || (n = /* @__PURE__ */ new WeakMap(), e.buckets.set(t, n)), n;
}
var Ai, ji = [], Mi = {
	alloc(e, t, n) {
		let r = Ai;
		if (!r) return n;
		Ai = void 0;
		let i = {
			value: n,
			issues: null
		};
		return r.set(t.value, i), ji.push(i), n;
	},
	guard(e) {
		var t;
		(t = e._zod).deferred ?? (t.deferred = []), e._zod.deferred.push(() => {
			let t = e._zod.parse, n = (e, n) => {
				if (n.direction !== "backward" && Pi(n, e.value)) throw new vi();
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
					let i = Di(e, /* @__PURE__ */ new Set(), !1);
					if (i === wi) return e._zod.parse = t, e._zod.run === o && (e._zod.run = t), t(s, c);
					i === Ei || r ? n = !0 : r = !0;
				}
				let l = s.value;
				if (!xi(l)) return t(s, c);
				let u = c[yi];
				u || (u = {
					buckets: /* @__PURE__ */ new WeakMap(),
					backEdges: void 0
				}, c[yi] = u);
				let d;
				i === c ? d = a : (d = ki(u, e), i = c, a = d);
				let f = d.get(l);
				if (f) return s.value = f.value, f.issues ? f.issues.length && s.issues.push(...Si(f.issues)) : (s.memo = !0, u.backEdges ?? (u.backEdges = /* @__PURE__ */ new WeakSet()), u.backEdges.add(f.value)), s;
				Ai = d;
				let p = ji.length, m = t(s, c);
				Ai = void 0;
				let h = ji.length > p ? ji.pop() : void 0;
				return m instanceof Promise ? m.then((e) => (h && (h.issues = e.issues.length ? Si(e.issues) : bi), e)) : (h && (h.issues = m.issues.length ? Si(m.issues) : bi), m);
			};
			e._zod.parse = o, e._zod.run === t && (e._zod.run = o);
		});
	}
};
function Ni() {
	return Mi;
}
function Pi(e, t) {
	let n = e[yi]?.backEdges;
	return n !== void 0 && xi(t) && n.has(t);
}
// node_modules/zod/v4/locales/en.js
var Fi = () => {
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
			case "invalid_type": return `Invalid input: expected ${i(e.expected)}, received ${i(qe(e.input), e.input)}`;
			case "invalid_value": return e.values.length === 1 ? `Invalid input: expected ${we(e.values[0])}` : `Invalid option: expected one of ${x(e.values, "|")}`;
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
			case "unrecognized_keys": return `Unrecognized key${e.keys.length > 1 ? "s" : ""}: ${x(e.keys, ", ")}`;
			case "invalid_key": return `Invalid key in ${e.origin}`;
			case "invalid_union": return e.options && Array.isArray(e.options) && e.options.length > 0 ? `Invalid discriminator value. Expected ${e.options.map((e) => `'${e}'`).join(" | ")}` : e.inclusive === !1 ? "Invalid input: more than one option matched" : "Invalid input";
			case "invalid_element": return `Invalid value in ${e.origin}`;
			default: return "Invalid input";
		}
	};
};
function Ii() {
	return { localeError: Fi() };
}
// node_modules/zod/v4/core/registries.js
var Li, Ri = class {
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
function zi() {
	return new Ri();
}
(Li = globalThis).__zod_globalRegistry ?? (Li.__zod_globalRegistry = zi());
var Bi = globalThis.__zod_globalRegistry;
// node_modules/zod/v4/core/api.js
function Vi(e) {
	return e.checks &&= [...e.checks], e;
}
// @__NO_SIDE_EFFECTS__
function Hi(e, t) {
	return new e(Vi({
		type: "string",
		...C(t)
	}));
}
// @__NO_SIDE_EFFECTS__
function Ui(e, t) {
	return new e({
		type: "string",
		format: "email",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Wi(e, t) {
	return new e({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Gi(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ki(e, t) {
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
function qi(e, t) {
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
function Ji(e, t) {
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
function Yi(e, t) {
	return new e({
		type: "string",
		format: "url",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Xi(e, t) {
	return new e({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Zi(e, t) {
	return new e({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Qi(e, t) {
	return new e({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function $i(e, t) {
	return new e({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ea(e, t) {
	return new e({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ta(e, t) {
	return new e({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function na(e, t) {
	return new e({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ra(e, t) {
	return new e({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ia(e, t) {
	return new e({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function aa(e, t) {
	return new e({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function oa(e, t) {
	return new e({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function sa(e, t) {
	return new e({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ca(e, t) {
	return new e({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function la(e, t) {
	return new e({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ua(e, t) {
	return new e({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function da(e, t) {
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
function fa(e, t) {
	return new e({
		type: "string",
		format: "date",
		check: "string_format",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function pa(e, t) {
	return new e({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ma(e, t) {
	return new e({
		type: "string",
		format: "duration",
		check: "string_format",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ha(e, t) {
	return new e(Vi({
		type: "number",
		checks: [],
		...C(t)
	}));
}
// @__NO_SIDE_EFFECTS__
function ga(e, t) {
	return new e({
		type: "number",
		check: "number_format",
		abort: !1,
		format: "safeint",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function _a(e, t) {
	return new e({
		type: "boolean",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function va(e) {
	return new e({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function ya(e, t) {
	return new e({
		type: "never",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ba(e, t) {
	return new wn({
		check: "less_than",
		...C(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function xa(e, t) {
	return new wn({
		check: "less_than",
		...C(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function Sa(e, t) {
	return new Tn({
		check: "greater_than",
		...C(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function Ca(e, t) {
	return new Tn({
		check: "greater_than",
		...C(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function wa(e, t) {
	return new En({
		check: "multiple_of",
		...C(t),
		value: e
	});
}
// @__NO_SIDE_EFFECTS__
function Ta(e, t) {
	return new On({
		check: "max_length",
		...C(t),
		maximum: e
	});
}
// @__NO_SIDE_EFFECTS__
function Ea(e, t) {
	return new kn({
		check: "min_length",
		...C(t),
		minimum: e
	});
}
// @__NO_SIDE_EFFECTS__
function Da(e, t) {
	return new An({
		check: "length_equals",
		...C(t),
		length: e
	});
}
// @__NO_SIDE_EFFECTS__
function Oa(e, t) {
	return new Mn({
		check: "string_format",
		format: "regex",
		...C(t),
		pattern: e
	});
}
// @__NO_SIDE_EFFECTS__
function ka(e) {
	return new Nn({
		check: "string_format",
		format: "lowercase",
		...C(e)
	});
}
// @__NO_SIDE_EFFECTS__
function Aa(e) {
	return new Pn({
		check: "string_format",
		format: "uppercase",
		...C(e)
	});
}
// @__NO_SIDE_EFFECTS__
function ja(e, t) {
	return new Fn({
		check: "string_format",
		format: "includes",
		...C(t),
		includes: e
	});
}
// @__NO_SIDE_EFFECTS__
function Ma(e, t) {
	return new In({
		check: "string_format",
		format: "starts_with",
		...C(t),
		prefix: e
	});
}
// @__NO_SIDE_EFFECTS__
function Na(e, t) {
	return new Ln({
		check: "string_format",
		format: "ends_with",
		...C(t),
		suffix: e
	});
}
// @__NO_SIDE_EFFECTS__
function Pa(e) {
	return new Rn({
		check: "overwrite",
		tx: e
	});
}
// @__NO_SIDE_EFFECTS__
function Fa(e) {
	return /* @__PURE__ */ Pa((t) => t.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function Ia() {
	return /* @__PURE__ */ Pa((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function La() {
	return /* @__PURE__ */ Pa((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function Ra() {
	return /* @__PURE__ */ Pa((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function za() {
	return /* @__PURE__ */ Pa((e) => he(e));
}
// @__NO_SIDE_EFFECTS__
function Ba(e, t, n) {
	return new e({
		type: "array",
		element: t,
		...C(n)
	});
}
// @__NO_SIDE_EFFECTS__
function Va(e, t, n) {
	let r = C(n);
	return r.abort ??= !0, new e({
		type: "custom",
		check: "custom",
		fn: t,
		...r
	});
}
// @__NO_SIDE_EFFECTS__
function Ha(e, t, n) {
	return new e({
		type: "custom",
		check: "custom",
		fn: t,
		...C(n)
	});
}
// @__NO_SIDE_EFFECTS__
function Ua(e, t) {
	let n = /* @__PURE__ */ Wa((t) => (t.addIssue = (e) => {
		if (typeof e == "string") t.issues.push(Je(e, t.value, n._zod.def));
		else {
			let r = e;
			r.fatal && (r.continue = !1), r.code ??= "custom", "input" in r || (r.input = t.value), r.inst ??= n, r.continue ??= !n._zod.def.abort, t.issues.push(Je(r));
		}
	}, e(t.value, t)), t);
	return n;
}
// @__NO_SIDE_EFFECTS__
function Wa(e, t) {
	let n = new D({
		check: "custom",
		...C(t)
	});
	return n._zod.check = e, n;
}
// node_modules/zod/v4/core/to-json-schema.js
function Ga(e, ...t) {
	for (let n of t) for (let t of Reflect.ownKeys(n)) Object.prototype.propertyIsEnumerable.call(n, t) && se(e, t, n[t]);
	return e;
}
function Ka(e) {
	let t = e?.target ?? "draft-2020-12";
	return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
		processors: e.processors ?? {},
		metadataRegistry: e?.metadata ?? Bi,
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
function qa(e, t, n, r, i) {
	let a = typeof t.unrepresentable == "function" ? t.unrepresentable({
		zodSchema: e,
		path: r.path,
		message: i
	}) : t.unrepresentable;
	if (a === "any") return !1;
	if (a === void 0 || a === "throw") throw Error(i);
	return Object.assign(n, a), !0;
}
function A(e, t, n = {
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
		a && (o.ref ||= a, A(a, t, r), t.seen.get(a).isParent = !0);
	}
	let c = t.metadataRegistry.get(e);
	return c && Ga(o.schema, c), t.io === "input" && j(e) && (delete o.schema.examples, delete o.schema.default), t.io === "input" && "_prefault" in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)), delete o.schema._prefault, t.seen.get(e).schema;
}
function Ja(e) {
	return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
function Ya(e, t) {
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
				ref: `${i("__shared")}#/${r}/${Ja(a)}`
			};
		}
		let i = `#/${r}/`;
		if (t[1] === n && !t[1].schema.id) return { ref: "#" };
		let a = t[1].schema.id ?? `__schema${e.counter++}`;
		return {
			defId: a,
			ref: i + Ja(a)
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
function Xa(e) {
	let t = e.anyOf;
	if (!Array.isArray(t) || t.length === 0 || e.type !== void 0) return;
	let n = [];
	for (let e of t) {
		if (!e || typeof e != "object") return;
		Xa(e);
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
var Za = /* @__PURE__ */ new Set([
	"type",
	"properties",
	"required",
	"additionalProperties"
]), Qa = ["oneOf", "anyOf"];
function $a(e) {
	let t = e.additionalProperties;
	return t === void 0 || t === !1 || typeof t != "object" || !t ? null : Object.keys(t).length ? t : null;
}
function eo(e) {
	let t = [];
	for (let n of e) {
		if (typeof n != "object" || n.type !== "object") return null;
		for (let e in n) if (!Za.has(e)) return null;
		t.push(n);
	}
	let n = {}, r = /* @__PURE__ */ new Set();
	for (let e of t) {
		for (let r in e.properties) {
			if (Object.prototype.hasOwnProperty.call(n, r)) continue;
			let e = [];
			for (let n of t) {
				let t = n.properties?.[r] ?? $a(n);
				t != null && (e.some((e) => JSON.stringify(e) === JSON.stringify(t)) || e.push(t));
			}
			se(n, r, e.length === 1 ? e[0] : eo(e) ?? { allOf: e });
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
			let t = $a(n);
			t && !e.some((e) => JSON.stringify(e) === JSON.stringify(t)) && e.push(t);
		}
		e.length === 1 ? i.additionalProperties = e[0] : e.length > 1 && (i.additionalProperties = { allOf: e });
	}
	return i;
}
function to(e) {
	let t = e.allOf;
	if (!Array.isArray(t) || t.length < 2) return;
	for (let t of Za) if (t in e) return;
	let n = t.filter((e) => Qa.some((t) => Array.isArray(e[t]))), r = null;
	if (!n.length) r = eo(t);
	else {
		let e = n[0], i = Qa.find((t) => Array.isArray(e[t]));
		if (Object.keys(e).length !== 1) return;
		let a = t.filter((t) => t !== e), o = e[i].map((e) => eo([...a, e]));
		if (o.some((e) => !e)) return;
		r = { [i]: o };
	}
	r && (delete e.allOf, Ga(e, r));
}
function no(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	let r = (t) => {
		let n = e.seen.get(t);
		if (n.ref === null) return;
		let i = n.def ?? n.schema, a = { ...i }, o = n.ref;
		if (n.ref = null, o) {
			r(o);
			let n = e.seen.get(o), s = n.schema;
			if (s.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (i.allOf = i.allOf ?? [], i.allOf.push(s)) : Ga(i, s), Ga(i, a), t._zod.parent === o) for (let e in i) e !== "$ref" && e !== "allOf" && (e in a || delete i[e]);
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
		if (e.target !== "openapi-3.0") for (let t of e.seen.entries()) Xa(t[1].def ?? t[1].schema);
		for (let t of e.deferred) t();
		if (e.intersections.length) {
			let t = /* @__PURE__ */ new Map();
			for (let n of e.seen.values()) for (let e of [n.schema, n.def]) {
				let n = e?.allOf;
				if (!Array.isArray(n)) continue;
				let r = t.get(n);
				r ? r.push(e) : t.set(n, [e]);
			}
			for (let n of e.intersections) for (let e of t.get(n) ?? []) to(e);
		}
	}
	let i = {};
	if (e.target === "draft-2020-12" ? i.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? i.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? i.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
		let n = e.external.registry.get(t)?.id;
		if (!n) throw Error("Schema is missing an `id` property");
		i.$id = e.external.uri(n);
	}
	Ga(i, n.defId ? n.schema : n.def ?? n.schema);
	let a = e.metadataRegistry.get(t)?.id;
	a !== void 0 && i.id === a && delete i.id;
	let o = e.external?.defs ?? {};
	if (!e.external || e.sharedEmitDoneFor !== e.external) for (let t of e.seen.entries()) {
		let e = t[1];
		e.def && e.defId && (e.def.id === e.defId && delete e.def.id, se(o, e.defId, e.def));
	}
	e.external && (e.sharedEmitDoneFor = e.external), e.external || Object.keys(o).length > 0 && (e.target === "draft-2020-12" ? i.$defs = o : i.definitions = o);
	try {
		let n = JSON.parse(JSON.stringify(i));
		return Object.defineProperty(n, "~standard", {
			value: {
				...t["~standard"],
				jsonSchema: {
					input: io(t, "input", e.processors),
					output: io(t, "output", e.processors)
				}
			},
			enumerable: !1,
			writable: !1
		}), n;
	} catch {
		throw Error("Error converting schema to JSON.");
	}
}
function j(e, t) {
	let n = t ?? { seen: /* @__PURE__ */ new Set() };
	if (n.seen.has(e)) return !1;
	n.seen.add(e);
	let r = e._zod.def;
	if (r.type === "transform") return !0;
	if (r.type === "array") return j(r.element, n);
	if (r.type === "set") return j(r.valueType, n);
	if (r.type === "lazy") return j(r.getter(), n);
	if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault" || r.type === "catch") return j(r.innerType, n);
	if (r.type === "intersection") return j(r.left, n) || j(r.right, n);
	if (r.type === "record" || r.type === "map") return j(r.keyType, n) || j(r.valueType, n);
	if (r.type === "pipe") return e._zod.traits.has("$ZodCodec") ? !0 : j(r.in, n) || j(r.out, n);
	if (r.type === "object") {
		for (let e in r.shape) if (j(r.shape[e], n)) return !0;
		return !1;
	}
	if (r.type === "union") {
		for (let e of r.options) if (j(e, n)) return !0;
		return !1;
	}
	if (r.type === "tuple") {
		for (let e of r.items) if (j(e, n)) return !0;
		return !!(r.rest && j(r.rest, n));
	}
	return !1;
}
var ro = (e, t = {}) => (n) => {
	let r = Ka({
		...n,
		processors: t
	});
	return A(e, r), Ya(r, e), no(r, e);
}, io = (e, t, n = {}) => (r) => {
	let { libraryOptions: i, target: a } = r ?? {}, o = Ka({
		...i ?? {},
		target: a,
		io: t,
		processors: n
	});
	return A(e, o), Ya(o, e), no(o, e);
}, ao = (e, t, n) => {
	(e[t] === void 0 || n > e[t]) && (e[t] = n);
}, oo = (e, t, n) => {
	(e[t] === void 0 || n < e[t]) && (e[t] = n);
}, so = (e, t) => {
	ao(e, "minimum", t), oo(e, "maximum", t);
}, co = (e, t) => {
	e.multipleOf ??= [], e.multipleOf.includes(t) || e.multipleOf.push(t);
}, lo = (e, t) => {
	e.patterns ??= /* @__PURE__ */ new Set(), e.patterns.add(t);
}, uo = (e, t) => {
	e.mime = e.mime ? e.mime.filter((e) => t.includes(e)) : [...t];
}, fo = (e, t) => {
	e.format = t, t.includes("int") && (e.isInt = !0);
}, po = (e, t) => ao(e, "minimum", t.minimum), mo = (e, t) => oo(e, "maximum", t.maximum), ho = (e) => (t, n) => {
	fo(t, n.format);
	let [r, i] = e[n.format];
	ao(t, "minimum", r), oo(t, "maximum", i);
}, go = {
	greater_than: (e, t) => ao(e, t.inclusive ? "minimum" : "exclusiveMinimum", t.value),
	less_than: (e, t) => oo(e, t.inclusive ? "maximum" : "exclusiveMaximum", t.value),
	multiple_of: (e, t) => co(e, t.value),
	number_format: ho(Ee),
	bigint_format: ho(De),
	min_length: po,
	max_length: mo,
	length_equals: (e, t) => so(e, t.length),
	min_size: po,
	max_size: mo,
	size_equals: (e, t) => so(e, t.size),
	string_format: (e, t) => {
		fo(e, t.format), t.pattern && lo(e, t.pattern), (t.format === "base64" || t.format === "base64url") && (e.contentEncoding = t.format), (t.local || t.precision === -1) && (e.laxFormat = !0);
	},
	mime_type: (e, t) => uo(e, t.mime)
};
function _o(e) {
	let t = {}, n = e._zod.def, r = e._zod.traits.has("$ZodCheck") ? [e, ...n.checks ?? []] : n.checks ?? [];
	for (let e of r) go[e._zod.def.check]?.(t, e._zod.def);
	let i = e._zod.bag;
	i.minimum !== void 0 && ao(t, "minimum", i.minimum), i.exclusiveMinimum !== void 0 && ao(t, "exclusiveMinimum", i.exclusiveMinimum), i.maximum !== void 0 && oo(t, "maximum", i.maximum), i.exclusiveMaximum !== void 0 && oo(t, "exclusiveMaximum", i.exclusiveMaximum), i.multipleOf !== void 0 && co(t, i.multipleOf), i.format !== void 0 && (t.format ??= i.format, i.format.includes("int") && (t.isInt = !0)), i.mime && uo(t, i.mime);
	for (let e of i.patterns ?? []) lo(t, e);
	return t;
}
var vo = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
}, yo = /* @__PURE__ */ new Map([[xr, on], [Cr, sn]]), bo = (e) => yo.get(e) ?? e, xo = (e, t, n, r) => {
	let i = n;
	i.type = "string";
	let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l, laxFormat: u } = _o(e);
	if (typeof a == "number" && (i.minLength = a), typeof o == "number" && (i.maxLength = o), s && (i.format = vo[s] ?? s, i.format === "" && delete i.format, (s === "time" || u) && delete i.format), l && (i.contentEncoding = l), c && c.size > 0) {
		let e = [...c].map(bo);
		e.length === 1 ? i.pattern = e[0].source : e.length > 1 && (i.allOf = [...e.map((e) => ({
			...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: e.source
		}))]);
	}
}, So = (e, t, n, r) => {
	let i = n, { minimum: a, maximum: o, multipleOf: s, exclusiveMaximum: c, exclusiveMinimum: l, isInt: u } = _o(e);
	i.type = u ? "integer" : "number";
	let d = typeof l == "number" && l >= (a ?? -Infinity), f = typeof c == "number" && c <= (o ?? Infinity), p = t.target === "draft-04" || t.target === "openapi-3.0";
	if (d ? p ? (i.minimum = l, i.exclusiveMinimum = !0) : i.exclusiveMinimum = l : typeof a == "number" && (i.minimum = a), f ? p ? (i.maximum = c, i.exclusiveMaximum = !0) : i.exclusiveMaximum = c : typeof o == "number" && (i.maximum = o), s) {
		let n = /* @__PURE__ */ new Set();
		for (let a of s) Number.isFinite(a) && a !== 0 ? n.add(Math.abs(a)) : qa(e, t, i, r, `A multipleOf divisor of ${a} cannot be represented in JSON Schema`);
		let [a, ...o] = n;
		a !== void 0 && (i.multipleOf = a), o.length && (i.allOf = [...i.allOf ?? [], ...o.map((e) => ({ multipleOf: e }))]);
	}
}, Co = (e, t, n, r) => {
	n.type = "boolean";
}, wo = (e, t, n, r) => {
	n.not = {};
}, To = (e, t, n, r) => {
	let i = e._zod.def, a = b(i.entries);
	a.length === 0 ? n.not = {} : (a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), n.enum = a);
}, Eo = (e, t, n, r) => {
	let i = e._zod.def;
	if (i.values.length === 0) {
		n.not = {};
		return;
	}
	let a = [];
	for (let o of i.values) if (o === void 0) {
		if (qa(e, t, n, r, "Literal `undefined` cannot be represented in JSON Schema")) return;
	} else if (typeof o == "bigint") {
		if (qa(e, t, n, r, "BigInt literals cannot be represented in JSON Schema")) return;
		a.push(Number(o));
	} else a.push(o);
	if (a.length !== 0) {
		if (a.length === 1) {
			let e = a[0];
			n.type = e === null ? "null" : typeof e, t.target === "draft-04" || t.target === "openapi-3.0" ? n.enum = [e] : n.const = e;
		} else a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), a.every((e) => typeof e == "boolean") && (n.type = "boolean"), a.every((e) => e === null) && (n.type = "null"), n.enum = a;
	}
}, Do = (e, t, n, r) => {
	qa(e, t, n, r, "Custom types cannot be represented in JSON Schema");
}, Oo = (e, t, n, r) => {
	qa(e, t, n, r, "Transforms cannot be represented in JSON Schema");
}, ko = (e, t, n, r) => {
	let i = n, a = e._zod.def, { minimum: o, maximum: s } = _o(e);
	typeof o == "number" && (i.minItems = o), typeof s == "number" && (i.maxItems = s), i.type = "array", i.items = A(a.element, t, {
		...r,
		path: [...r.path, "items"]
	});
};
function Ao(e) {
	let t = e._zod.def;
	return t.type === "pipe" && t.in._zod.traits.has("$ZodTransform") ? Ao(t.out) : t.type === "catch" ? Ao(t.innerType) : e._zod.optin;
}
var jo = (e, t, n, r) => {
	let i = n, a = e._zod.def, o = a.shape;
	if (Object.getOwnPropertySymbols(o).length && qa(e, t, i, r, "Symbol keys cannot be represented in JSON Schema")) return;
	i.type = "object", i.properties = {};
	for (let e in o) se(i.properties, e, A(o[e], t, {
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
		(t.io === "input" ? Ao(n) === void 0 : n._zod.optout === void 0) && s.push(e);
	}
	s.length > 0 && (i.required = s), a.catchall?._zod.def.type === "never" ? i.additionalProperties = !1 : a.catchall ? a.catchall && (i.additionalProperties = A(a.catchall, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	})) : t.io === "output" && (i.additionalProperties = !1);
}, Mo = (e, t, n, r) => {
	let i = e._zod.def, a = i.inclusive === !1, o = i.options.map((e, n) => A(e, t, {
		...r,
		path: [
			...r.path,
			a ? "oneOf" : "anyOf",
			n
		]
	}));
	a ? n.oneOf = o : n.anyOf = o;
}, No = (e, t, n, r) => {
	let i = e._zod.def, a = A(i.left, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			0
		]
	}), o = A(i.right, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			1
		]
	}), s = (e) => "allOf" in e && Object.keys(e).length === 1, c = [...s(a) ? a.allOf : [a], ...s(o) ? o.allOf : [o]];
	n.allOf = c, t.intersections.push(c);
};
function Po(e, t, n) {
	if (t.$ref) {
		if (n.has(t)) return t;
		n.add(t);
		let r = e.get(t)?.def;
		if (!r) return t;
		let i = Po(e, r, n);
		return i === r ? t : i;
	}
	for (let r of ["anyOf", "oneOf"]) {
		let i = t[r];
		if (!Array.isArray(i)) continue;
		let a = i.map((t) => Po(e, t, n));
		a.some((e, t) => e !== i[t]) && (t = {
			...t,
			[r]: a
		});
	}
	let r = Array.isArray(t.type) ? t.type : [t.type], i = !r.includes("string") && r.some((e) => e === "number" || e === "integer"), a = t.enum ?? (t.const === void 0 ? void 0 : [t.const]);
	if (!i && !a?.some((e) => typeof e == "number")) return t;
	let { minimum: o, maximum: s, exclusiveMinimum: c, exclusiveMaximum: l, multipleOf: u, format: d, id: f, ...p } = t;
	return p.enum ? p.enum = p.enum.map((e) => typeof e == "number" ? String(e) : e) : typeof p.const == "number" && (p.const = String(p.const)), i && (p.type = "string", a || (p.pattern = (r.includes("number") ? vn : _n).source)), p;
}
var Fo = /* @__PURE__ */ new WeakMap();
function Io(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.seen.values()) n.def && !t.has(n.schema) && t.set(n.schema, n);
	let n = /* @__PURE__ */ new Map();
	for (let r of Fo.get(e) ?? []) {
		let i = e.seen.get(r), a = (i?.def ?? i?.schema)?.propertyNames;
		if (!a || a === !0 || n.has(a)) continue;
		let o = Po(t, a, /* @__PURE__ */ new Set());
		o !== a && n.set(a, o);
	}
	if (n.size) for (let t of e.seen.values()) for (let e of [t.schema, t.def]) {
		let t = e && n.get(e.propertyNames);
		t && (e.propertyNames = t);
	}
}
var Lo = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object";
	let o = a.keyType, s = _o(o).patterns;
	if (a.mode === "loose" && s && s.size > 0) {
		let e = A(a.valueType, t, {
			...r,
			path: [
				...r.path,
				"patternProperties",
				"*"
			]
		});
		i.patternProperties = {};
		for (let t of s) se(i.patternProperties, bo(t).source, e);
	} else {
		if (t.target === "draft-07" || t.target === "draft-2020-12") {
			i.propertyNames = A(a.keyType, t, {
				...r,
				path: [...r.path, "propertyNames"]
			});
			let n = Fo.get(t);
			n || (n = [], Fo.set(t, n), t.deferred.push(() => Io(t))), n.push(e);
		}
		i.additionalProperties = A(a.valueType, t, {
			...r,
			path: [...r.path, "additionalProperties"]
		});
	}
	let c = o._zod.values, l = t.io === "input" && Ao(a.valueType) !== void 0;
	if (c && !a.partial && !l) {
		let e = [...c].filter((e) => typeof e == "string" || typeof e == "number");
		e.length > 0 && (i.required = e.map(String));
	}
}, Ro = (e, t, n, r) => {
	let i = e._zod.def, a = A(i.innerType, t, r), o = t.seen.get(e);
	t.target === "openapi-3.0" ? (o.ref = i.innerType, n.nullable = !0) : n.anyOf = [a, { type: "null" }];
}, zo = (e, t, n, r) => {
	let i = e._zod.def;
	A(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Bo = Symbol();
function Vo(e, t, n, r, i) {
	let a = !1, o = JSON.stringify(e, (e, t) => typeof t == "bigint" ? (a = !0, null) : t);
	return a ? (qa(t, n, r, i, "BigInt defaults cannot be represented in JSON Schema"), Bo) : JSON.parse(o);
}
var Ho = (e, t, n, r) => {
	let i = e._zod.def;
	A(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o = Vo(i.defaultValue, e, t, n, r);
	o !== Bo && (n.default = o);
}, Uo = (e, t, n, r) => {
	let i = e._zod.def;
	A(i.innerType, t, r);
	let a = t.seen.get(e);
	if (a.ref = i.innerType, t.io !== "input") return;
	let o = Vo(i.defaultValue, e, t, n, r);
	o !== Bo && (n._prefault = o);
}, Wo = (e, t, n, r) => {
	let i = e._zod.def;
	A(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o;
	try {
		o = i.catchValue(void 0);
	} catch {
		qa(e, t, n, r, "Dynamic catch values are not supported in JSON Schema");
		return;
	}
	n.default = o;
}, Go = (e, t, n, r) => {
	let i = e._zod.def, a = i.in._zod.traits.has("$ZodTransform"), o = t.io === "input" ? a ? i.out : i.in : i.out;
	A(o, t, r);
	let s = t.seen.get(e);
	s.ref = o;
}, Ko = (e, t, n, r) => {
	let i = e._zod.def;
	A(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.readOnly = !0;
}, qo = (e, t, n, r) => {
	let i = e._zod.def;
	A(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Jo = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function Yo(e, t, n) {
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
var M = /*@__PURE__*/ T("ZodError", (e, t) => {
	yt.init(e, t), e.name = "ZodError";
	let n = Object.getPrototypeOf(e);
	Jo.has(n) || (Jo.add(n), Yo(n, "format", (e) => (t) => St(e, t)), Yo(n, "flatten", (e) => (t) => xt(e, t)), Yo(n, "addIssue", (e) => (t) => {
		e.issues.push(t), e.message = JSON.stringify(e.issues, te, 2);
	}), Yo(n, "addIssues", (e) => (t) => {
		e.issues.push(...t), e.message = JSON.stringify(e.issues, te, 2);
	}), Object.defineProperty(n, "isEmpty", {
		configurable: !0,
		enumerable: !1,
		get() {
			return this.issues.length === 0;
		}
	}));
}, void 0, { Parent: Error }), Xo = /* @__PURE__ */ wt(M), Zo = /* @__PURE__ */ Tt(M), Qo = /* @__PURE__ */ Et(M), $o = /* @__PURE__ */ Ot(M), es = /* @__PURE__ */ Pt(M), ts = /* @__PURE__ */ Ft(M), ns = /* @__PURE__ */ It(M), rs = /* @__PURE__ */ Lt(M), is = /* @__PURE__ */ Rt(M), as = /* @__PURE__ */ zt(M), os = /* @__PURE__ */ Bt(M), ss = /* @__PURE__ */ Vt(M);
// node_modules/zod/v4/classic/schemas.js
function cs() {
	E.localeError || pt(Ii());
}
function ls() {
	E.memoizer || pt({ memoizer: Ni() });
}
var N = /*@__PURE__*/ T("ZodType", (e, t) => (cs(), O.init(e, t), e.def = t, e.type = t.type, e), {
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
		return Ce(this, e, t);
	},
	brand() {
		return this;
	},
	register(e, t) {
		return e.add(this, t), this;
	},
	refine(e, t) {
		return this.check(Oc(e, t));
	},
	superRefine(e, t) {
		return this.check(kc(e, t));
	},
	overwrite(e) {
		return this.check(/* @__PURE__ */ Pa(e));
	},
	optional() {
		return lc(this);
	},
	exactOptional() {
		return dc(this);
	},
	nullable() {
		return pc(this);
	},
	nullish() {
		return lc(pc(this));
	},
	nonoptional(e) {
		return yc(this, e);
	},
	array() {
		return I(this);
	},
	or(e) {
		return Ys([this, e]);
	},
	and(e) {
		return $s(this, e);
	},
	transform(e) {
		return Cc(this, sc(e));
	},
	default(e) {
		return hc(this, e);
	},
	prefault(e) {
		return _c(this, e);
	},
	catch(e) {
		return xc(this, e);
	},
	pipe(e) {
		return Cc(this, e);
	},
	readonly() {
		return Tc(this);
	},
	describe(e) {
		let t = this.clone();
		return Bi.add(t, { description: e }), t;
	},
	meta(...e) {
		if (e.length === 0) return Bi.get(this);
		let t = this.clone();
		return Bi.add(t, e[0]), t;
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
		return Ze(this, "~standard", {
			...Un(this),
			jsonSchema: {
				input: io(this, "input"),
				output: io(this, "output")
			}
		});
	},
	set "~standard"(e) {
		Xe(this, "~standard", e);
	},
	parse: function e(t, n) {
		return Xo(this, t, n, { callee: e });
	},
	parseAsync: async function e(t, n) {
		return await Zo(this, t, n, { callee: e });
	},
	safeParse(e, t) {
		return Qo(this, e, t);
	},
	async safeParseAsync(e, t) {
		return $o(this, e, t);
	},
	get spa() {
		return this?.safeParseAsync;
	},
	set spa(e) {
		Xe(this, "spa", e);
	},
	validate(e, t) {
		return jt(this, e, t);
	},
	validateAsync(e, t) {
		return Nt(this, e, t);
	},
	encode: function e(t, n) {
		return es(this, t, n, { callee: e });
	},
	decode: function e(t, n) {
		return ts(this, t, n, { callee: e });
	},
	encodeAsync: async function e(t, n) {
		return await ns(this, t, n, { callee: e });
	},
	decodeAsync: async function e(t, n) {
		return await rs(this, t, n, { callee: e });
	},
	safeEncode(e, t) {
		return is(this, e, t);
	},
	safeDecode(e, t) {
		return as(this, e, t);
	},
	async safeEncodeAsync(e, t) {
		return os(this, e, t);
	},
	async safeDecodeAsync(e, t) {
		return ss(this, e, t);
	},
	toJSONSchema(e) {
		return ro(this, {})(e);
	},
	get description() {
		return Bi.get(this)?.description;
	},
	get _def() {
		return this._zod.def;
	}
}), us = /*@__PURE__*/ T("_ZodString", (e, t) => {
	Wn.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => xo(e, t, n, r);
}, /*@__PURE__*/ Qe({
	format: (e) => _o(e).format ?? null,
	minLength: (e) => _o(e).minimum ?? null,
	maxLength: (e) => _o(e).maximum ?? null
}, {
	regex(...e) {
		return this.check(/* @__PURE__ */ Oa(...e));
	},
	includes(...e) {
		return this.check(/* @__PURE__ */ ja(...e));
	},
	startsWith(...e) {
		return this.check(/* @__PURE__ */ Ma(...e));
	},
	endsWith(...e) {
		return this.check(/* @__PURE__ */ Na(...e));
	},
	min(...e) {
		return this.check(/* @__PURE__ */ Ea(...e));
	},
	max(...e) {
		return this.check(/* @__PURE__ */ Ta(...e));
	},
	length(...e) {
		return this.check(/* @__PURE__ */ Da(...e));
	},
	nonempty(...e) {
		return this.check(/* @__PURE__ */ Ea(1, ...e));
	},
	lowercase(e) {
		return this.check(/* @__PURE__ */ ka(e));
	},
	uppercase(e) {
		return this.check(/* @__PURE__ */ Aa(e));
	},
	trim() {
		return this.check(/* @__PURE__ */ Ia());
	},
	normalize(...e) {
		return this.check(/* @__PURE__ */ Fa(...e));
	},
	toLowerCase() {
		return this.check(/* @__PURE__ */ La());
	},
	toUpperCase() {
		return this.check(/* @__PURE__ */ Ra());
	},
	slugify() {
		return this.check(/* @__PURE__ */ za());
	}
})), ds = /*@__PURE__*/ T("ZodString", (e, t) => {
	Wn.init(e, t), us.init(e, t);
}, {
	email(e) {
		return this.check(/* @__PURE__ */ Ui(gs, e));
	},
	url(e) {
		return this.check(/* @__PURE__ */ Yi(bs, e));
	},
	jwt(e) {
		return this.check(/* @__PURE__ */ ua(Fs, e));
	},
	emoji(e) {
		return this.check(/* @__PURE__ */ Xi(xs, e));
	},
	guid(e) {
		return this.check(/* @__PURE__ */ Wi(_s, e));
	},
	uuid(e) {
		return this.check(/* @__PURE__ */ Gi(vs, e));
	},
	uuidv4(e) {
		return this.check(/* @__PURE__ */ Ki(vs, e));
	},
	uuidv6(e) {
		return this.check(/* @__PURE__ */ qi(vs, e));
	},
	uuidv7(e) {
		return this.check(/* @__PURE__ */ Ji(vs, e));
	},
	nanoid(e) {
		return this.check(/* @__PURE__ */ Zi(Ss, e));
	},
	cuid(e) {
		return this.check(/* @__PURE__ */ Qi(Cs, e));
	},
	cuid2(e) {
		return this.check(/* @__PURE__ */ $i(ws, e));
	},
	ulid(e) {
		return this.check(/* @__PURE__ */ ea(Ts, e));
	},
	base64(e) {
		return this.check(/* @__PURE__ */ sa(Ms, e));
	},
	base64url(e) {
		return this.check(/* @__PURE__ */ ca(Ns, e));
	},
	xid(e) {
		return this.check(/* @__PURE__ */ ta(Es, e));
	},
	ksuid(e) {
		return this.check(/* @__PURE__ */ na(Ds, e));
	},
	ipv4(e) {
		return this.check(/* @__PURE__ */ ra(Os, e));
	},
	ipv6(e) {
		return this.check(/* @__PURE__ */ ia(ks, e));
	},
	cidrv4(e) {
		return this.check(/* @__PURE__ */ aa(As, e));
	},
	cidrv6(e) {
		return this.check(/* @__PURE__ */ oa(js, e));
	},
	e164(e) {
		return this.check(/* @__PURE__ */ la(Ps, e));
	},
	datetime(e) {
		return this.check(/* @__PURE__ */ da(fs, e));
	},
	date(e) {
		return this.check(/* @__PURE__ */ fa(ps, e));
	},
	time(e) {
		return this.check(/* @__PURE__ */ pa(ms, e));
	},
	duration(e) {
		return this.check(/* @__PURE__ */ ma(hs, e));
	}
});
function P(e) {
	return /* @__PURE__ */ Hi(ds, e);
}
var F = /*@__PURE__*/ T("ZodStringFormat", (e, t) => {
	k.init(e, t), us.init(e, t);
}), fs = /*@__PURE__*/ T("ZodISODateTime", (e, t) => {
	lr.init(e, t), F.init(e, t);
}), ps = /*@__PURE__*/ T("ZodISODate", (e, t) => {
	ur.init(e, t), F.init(e, t);
}), ms = /*@__PURE__*/ T("ZodISOTime", (e, t) => {
	dr.init(e, t), F.init(e, t);
}), hs = /*@__PURE__*/ T("ZodISODuration", (e, t) => {
	fr.init(e, t), F.init(e, t);
}), gs = /*@__PURE__*/ T("ZodEmail", (e, t) => {
	qn.init(e, t), F.init(e, t);
}), _s = /*@__PURE__*/ T("ZodGUID", (e, t) => {
	Gn.init(e, t), F.init(e, t);
}), vs = /*@__PURE__*/ T("ZodUUID", (e, t) => {
	Kn.init(e, t), F.init(e, t);
});
function ys(e) {
	return /* @__PURE__ */ Gi(vs, e);
}
var bs = /*@__PURE__*/ T("ZodURL", (e, t) => {
	tr.init(e, t), F.init(e, t);
}), xs = /*@__PURE__*/ T("ZodEmoji", (e, t) => {
	nr.init(e, t), F.init(e, t);
}), Ss = /*@__PURE__*/ T("ZodNanoID", (e, t) => {
	rr.init(e, t), F.init(e, t);
}), Cs = /*@__PURE__*/ T("ZodCUID", (e, t) => {
	ir.init(e, t), F.init(e, t);
}), ws = /*@__PURE__*/ T("ZodCUID2", (e, t) => {
	ar.init(e, t), F.init(e, t);
}), Ts = /*@__PURE__*/ T("ZodULID", (e, t) => {
	or.init(e, t), F.init(e, t);
}), Es = /*@__PURE__*/ T("ZodXID", (e, t) => {
	sr.init(e, t), F.init(e, t);
}), Ds = /*@__PURE__*/ T("ZodKSUID", (e, t) => {
	cr.init(e, t), F.init(e, t);
}), Os = /*@__PURE__*/ T("ZodIPv4", (e, t) => {
	pr.init(e, t), F.init(e, t);
}), ks = /*@__PURE__*/ T("ZodIPv6", (e, t) => {
	gr.init(e, t), F.init(e, t);
}), As = /*@__PURE__*/ T("ZodCIDRv4", (e, t) => {
	_r.init(e, t), F.init(e, t);
}), js = /*@__PURE__*/ T("ZodCIDRv6", (e, t) => {
	yr.init(e, t), F.init(e, t);
}), Ms = /*@__PURE__*/ T("ZodBase64", (e, t) => {
	Sr.init(e, t), F.init(e, t);
}), Ns = /*@__PURE__*/ T("ZodBase64URL", (e, t) => {
	Tr.init(e, t), F.init(e, t);
}), Ps = /*@__PURE__*/ T("ZodE164", (e, t) => {
	Er.init(e, t), F.init(e, t);
}), Fs = /*@__PURE__*/ T("ZodJWT", (e, t) => {
	Or.init(e, t), F.init(e, t);
}), Is = /*@__PURE__*/ T("ZodNumber", (e, t) => {
	kr.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => So(e, t, n, r), e.isFinite = !0;
}, /*@__PURE__*/ Qe({
	minValue: (e) => {
		let { minimum: t, exclusiveMinimum: n } = _o(e);
		return Math.max(t ?? -Infinity, n ?? -Infinity);
	},
	maxValue: (e) => {
		let { maximum: t, exclusiveMaximum: n } = _o(e);
		return Math.min(t ?? Infinity, n ?? Infinity);
	},
	isInt: (e) => {
		let { isInt: t, multipleOf: n } = _o(e);
		return !!t || !!n?.some(Number.isSafeInteger);
	},
	format: (e) => _o(e).format ?? null
}, {
	gt(e, t) {
		return this.check(/* @__PURE__ */ Sa(e, t));
	},
	gte(e, t) {
		return this.check(/* @__PURE__ */ Ca(e, t));
	},
	min(e, t) {
		return this.check(/* @__PURE__ */ Ca(e, t));
	},
	lt(e, t) {
		return this.check(/* @__PURE__ */ ba(e, t));
	},
	lte(e, t) {
		return this.check(/* @__PURE__ */ xa(e, t));
	},
	max(e, t) {
		return this.check(/* @__PURE__ */ xa(e, t));
	},
	int(e) {
		return this.check(zs(e));
	},
	safe(e) {
		return this.check(zs(e));
	},
	positive(e) {
		return this.check(/* @__PURE__ */ Sa(0, e));
	},
	nonnegative(e) {
		return this.check(/* @__PURE__ */ Ca(0, e));
	},
	negative(e) {
		return this.check(/* @__PURE__ */ ba(0, e));
	},
	nonpositive(e) {
		return this.check(/* @__PURE__ */ xa(0, e));
	},
	multipleOf(e, t) {
		return this.check(/* @__PURE__ */ wa(e, t));
	},
	step(e, t) {
		return this.check(/* @__PURE__ */ wa(e, t));
	},
	finite() {
		return this;
	}
}));
function Ls(e) {
	return /* @__PURE__ */ ha(Is, e);
}
var Rs = /*@__PURE__*/ T("ZodNumberFormat", (e, t) => {
	Ar.init(e, t), Is.init(e, t);
});
function zs(e) {
	return /* @__PURE__ */ ga(Rs, e);
}
var Bs = /*@__PURE__*/ T("ZodBoolean", (e, t) => {
	jr.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Co(e, t, n, r);
});
function Vs(e) {
	return /* @__PURE__ */ _a(Bs, e);
}
var Hs = /*@__PURE__*/ T("ZodUnknown", (e, t) => {
	Mr.init(e, t), N.init(e, t), e._zod.processJSONSchema = (e, t, n) => void 0;
});
function Us() {
	return /* @__PURE__ */ va(Hs);
}
var Ws = /*@__PURE__*/ T("ZodNever", (e, t) => {
	Nr.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => wo(e, t, n, r);
});
function Gs(e) {
	return /* @__PURE__ */ ya(Ws, e);
}
var Ks = /*@__PURE__*/ T("ZodArray", (e, t) => {
	ls(), Lr.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => ko(e, t, n, r), e.element = t.element;
}, {
	min(e, t) {
		return this.check(/* @__PURE__ */ Ea(e, t));
	},
	nonempty(e) {
		return this.check(/* @__PURE__ */ Ea(1, e));
	},
	max(e, t) {
		return this.check(/* @__PURE__ */ Ta(e, t));
	},
	length(e, t) {
		return this.check(/* @__PURE__ */ Da(e, t));
	},
	unwrap() {
		return this.element;
	}
});
function I(e, t) {
	return /* @__PURE__ */ Ba(Ks, e, t);
}
var qs = /*@__PURE__*/ T("ZodObject", (e, t) => {
	ls(), Ur.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => jo(e, t, n, r), it(e, "shape", (e) => e._zod.def.shape, !1);
}, {
	keyof() {
		return rc(Object.keys(this._zod.def.shape));
	},
	catchall(e) {
		return this.clone(S(this._zod.def, { catchall: e }));
	},
	passthrough() {
		return this.clone(S(this._zod.def, { catchall: Us() }));
	},
	loose() {
		return this.clone(S(this._zod.def, { catchall: Us() }));
	},
	strict() {
		return this.clone(S(this._zod.def, { catchall: Gs() }));
	},
	strip() {
		return this.clone(S(this._zod.def, { catchall: void 0 }));
	},
	extend(e) {
		return je(this, e);
	},
	safeExtend(e) {
		return Ne(this, e);
	},
	merge(e) {
		return Pe(this, e);
	},
	pick(e) {
		return Oe(this, e);
	},
	omit(e) {
		return Ae(this, e);
	},
	partial(...e) {
		return Fe(cc, this, e[0]);
	},
	exactPartial(...e) {
		return Fe(uc, this, e[0], "exactPartial");
	},
	required(...e) {
		return Ie(vc, this, e[0]);
	}
});
function L(e, t) {
	return new qs({
		type: "object",
		shape: e,
		catchall: Gs(),
		...C(t)
	});
}
var Js = /*@__PURE__*/ T("ZodUnion", (e, t) => {
	Gr.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Mo(e, t, n, r), e.options = t.options;
});
function Ys(e, t) {
	return new Js({
		type: "union",
		options: e,
		...C(t)
	});
}
var Xs = /*@__PURE__*/ T("ZodDiscriminatedUnion", (e, t) => {
	Js.init(e, t), qr.init(e, t);
});
function Zs(e, t, n) {
	return new Xs({
		type: "union",
		options: t,
		discriminator: e,
		...C(n)
	});
}
var Qs = /*@__PURE__*/ T("ZodIntersection", (e, t) => {
	Jr.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => No(e, t, n, r);
});
function $s(e, t) {
	return new Qs({
		type: "intersection",
		left: e,
		right: t
	});
}
var ec = /*@__PURE__*/ T("ZodRecord", (e, t) => {
	ls(), Zr.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Lo(e, t, n, r), e.keyType = t.keyType, e.valueType = t.valueType;
});
function tc(e, t, n) {
	return !t || !t._zod ? new ec({
		type: "record",
		keyType: P(),
		valueType: e,
		...C(t)
	}) : new ec({
		type: "record",
		keyType: e,
		valueType: t,
		...C(n)
	});
}
var nc = /*@__PURE__*/ T("ZodEnum", (e, t) => {
	Qr.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => To(e, t, n, r), e.enum = t.entries, e.options = [...e._zod.values];
	let n = new Set(Object.keys(t.entries));
	e.extract = (e, r) => {
		let i = {};
		for (let r of e) if (n.has(r)) i[r] = t.entries[r];
		else throw Error(`Key ${r} not found in enum`);
		return new nc({
			...t,
			checks: [],
			...C(r),
			entries: i
		});
	}, e.exclude = (e, r) => {
		let i = { ...t.entries };
		for (let t of e) if (n.has(t)) delete i[t];
		else throw Error(`Key ${t} not found in enum`);
		return new nc({
			...t,
			checks: [],
			...C(r),
			entries: i
		});
	};
});
function rc(e, t) {
	return new nc({
		type: "enum",
		entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
		...C(t)
	});
}
var ic = /*@__PURE__*/ T("ZodLiteral", (e, t) => {
	$r.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Eo(e, t, n, r), e.values = new Set(t.values), Object.defineProperty(e, "value", { get() {
		if (t.values.length > 1) throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return t.values[0];
	} });
});
function ac(e, t) {
	return new ic({
		type: "literal",
		values: Array.isArray(e) ? e : [e],
		...C(t)
	});
}
var oc = /*@__PURE__*/ T("ZodTransform", (e, t) => {
	ls(), ei.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Oo(e, t, n, r), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new ft(e.constructor.name);
		n.addIssue = (r) => {
			if (typeof r == "string") n.issues.push(Je(r, n.value, t));
			else {
				let t = r;
				t.fatal && (t.continue = !1), t.code ??= "custom", "input" in t || (t.input = n.value), t.inst ??= e, n.issues.push(Je(t));
			}
		};
		let i = t.transform(n.value, n);
		return i instanceof Promise ? i.then((e) => (n.value = e, n)) : (n.value = i, n);
	};
});
function sc(e) {
	return new oc({
		type: "transform",
		transform: e
	});
}
var cc = /*@__PURE__*/ T("ZodOptional", (e, t) => {
	ni.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => qo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function lc(e) {
	return new cc({
		type: "optional",
		innerType: e
	});
}
var uc = /*@__PURE__*/ T("ZodExactOptional", (e, t) => {
	ri.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => qo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function dc(e) {
	return new uc({
		type: "optional",
		innerType: e
	});
}
var fc = /*@__PURE__*/ T("ZodNullable", (e, t) => {
	ii.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ro(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function pc(e) {
	return new fc({
		type: "nullable",
		innerType: e
	});
}
var mc = /*@__PURE__*/ T("ZodDefault", (e, t) => {
	ai.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ho(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function hc(e, t) {
	return new mc({
		type: "default",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : be(t);
		}
	});
}
var gc = /*@__PURE__*/ T("ZodPrefault", (e, t) => {
	si.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Uo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function _c(e, t) {
	return new gc({
		type: "prefault",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : be(t);
		}
	});
}
var vc = /*@__PURE__*/ T("ZodNonOptional", (e, t) => {
	ci.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => zo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function yc(e, t) {
	return new vc({
		type: "nonoptional",
		innerType: e,
		...C(t)
	});
}
var bc = /*@__PURE__*/ T("ZodCatch", (e, t) => {
	di.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Wo(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function xc(e, t) {
	return new bc({
		type: "catch",
		innerType: e,
		catchValue: typeof t == "function" ? t : ot(t)
	});
}
var Sc = /*@__PURE__*/ T("ZodPipe", (e, t) => {
	fi.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Go(e, t, n, r), e.in = t.in, e.out = t.out;
});
function Cc(e, t) {
	return new Sc({
		type: "pipe",
		in: e,
		out: t
	});
}
var wc = /*@__PURE__*/ T("ZodReadonly", (e, t) => {
	mi.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ko(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Tc(e) {
	return new wc({
		type: "readonly",
		innerType: e
	});
}
var Ec = /*@__PURE__*/ T("ZodCustom", (e, t) => {
	gi.init(e, t), N.init(e, t), e._zod.processJSONSchema = (t, n, r) => Do(e, t, n, r);
});
function Dc(e, t) {
	return /* @__PURE__ */ Va(Ec, e ?? (() => !0), t);
}
function Oc(e, t = {}) {
	return /* @__PURE__ */ Ha(Ec, e, t);
}
function kc(e, t) {
	return /* @__PURE__ */ Ua(e, t);
}
// node_modules/zod/v4/classic/iso.js
function Ac(e) {
	return /* @__PURE__ */ da(fs, e);
}
// node_modules/yaml/browser/dist/nodes/identity.js
var jc = Symbol.for("yaml.alias"), Mc = Symbol.for("yaml.document"), Nc = Symbol.for("yaml.map"), Pc = Symbol.for("yaml.pair"), Fc = Symbol.for("yaml.scalar"), Ic = Symbol.for("yaml.seq"), R = Symbol.for("yaml.node.type"), Lc = (e) => !!e && typeof e == "object" && e[R] === jc, Rc = (e) => !!e && typeof e == "object" && e[R] === Mc, zc = (e) => !!e && typeof e == "object" && e[R] === Nc, z = (e) => !!e && typeof e == "object" && e[R] === Pc, B = (e) => !!e && typeof e == "object" && e[R] === Fc, Bc = (e) => !!e && typeof e == "object" && e[R] === Ic;
function V(e) {
	if (e && typeof e == "object") switch (e[R]) {
		case Nc:
		case Ic: return !0;
	}
	return !1;
}
function H(e) {
	if (e && typeof e == "object") switch (e[R]) {
		case jc:
		case Nc:
		case Fc:
		case Ic: return !0;
	}
	return !1;
}
var Vc = (e) => (B(e) || V(e)) && !!e.anchor, Hc = Symbol("break visit"), Uc = Symbol("skip children"), Wc = Symbol("remove node");
function Gc(e, t) {
	let n = qc(t);
	Rc(e) ? Kc(null, e.contents, n, Object.freeze([e])) === Wc && (e.contents = null) : Kc(null, e, n, Object.freeze([]));
}
Gc.BREAK = Hc, Gc.SKIP = Uc, Gc.REMOVE = Wc;
function Kc(e, t, n, r) {
	let i = Jc(e, t, n, r);
	if (H(i) || z(i)) return Yc(e, r, i), Kc(e, i, n, r);
	if (typeof i != "symbol") {
		if (V(t)) {
			r = Object.freeze(r.concat(t));
			for (let e = 0; e < t.items.length; ++e) {
				let i = Kc(e, t.items[e], n, r);
				if (typeof i == "number") e = i - 1;
				else if (i === Hc) return Hc;
				else i === Wc && (t.items.splice(e, 1), --e);
			}
		} else if (z(t)) {
			r = Object.freeze(r.concat(t));
			let e = Kc("key", t.key, n, r);
			if (e === Hc) return Hc;
			e === Wc && (t.key = null);
			let i = Kc("value", t.value, n, r);
			if (i === Hc) return Hc;
			i === Wc && (t.value = null);
		}
	}
	return i;
}
function qc(e) {
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
function Jc(e, t, n, r) {
	if (typeof n == "function") return n(e, t, r);
	if (zc(t)) return n.Map?.(e, t, r);
	if (Bc(t)) return n.Seq?.(e, t, r);
	if (z(t)) return n.Pair?.(e, t, r);
	if (B(t)) return n.Scalar?.(e, t, r);
	if (Lc(t)) return n.Alias?.(e, t, r);
}
function Yc(e, t, n) {
	let r = t[t.length - 1];
	if (V(r)) r.items[e] = n;
	else if (z(r)) e === "key" ? r.key = n : r.value = n;
	else if (Rc(r)) r.contents = n;
	else {
		let e = Lc(r) ? "alias" : "scalar";
		throw Error(`Cannot replace node with ${e} parent`);
	}
}
// node_modules/yaml/browser/dist/doc/directives.js
var Xc = {
	"!": "%21",
	",": "%2C",
	"[": "%5B",
	"]": "%5D",
	"{": "%7B",
	"}": "%7D"
}, Zc = (e) => e.replace(/[!,[\]{}]/g, (e) => Xc[e]), Qc = class e {
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
		for (let [t, n] of Object.entries(this.tags)) if (e.startsWith(n)) return t + Zc(e.substring(n.length));
		return e[0] === "!" ? e : `!<${e}>`;
	}
	toString(e) {
		let t = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [], n = Object.entries(this.tags), r;
		if (e && n.length > 0 && H(e.contents)) {
			let t = {};
			Gc(e.contents, (e, n) => {
				H(n) && n.tag && (t[n.tag] = !0);
			}), r = Object.keys(t);
		} else r = [];
		for (let [i, a] of n) i === "!!" && a === "tag:yaml.org,2002:" || e && !r.some((e) => e.startsWith(a)) || t.push(`%TAG ${i} ${a}`);
		return t.join("\n");
	}
};
Qc.defaultYaml = {
	explicit: !1,
	version: "1.2"
}, Qc.defaultTags = { "!!": "tag:yaml.org,2002:" };
// node_modules/yaml/browser/dist/doc/anchors.js
function $c(e) {
	if (/[\x00-\x19\s,[\]{}]/.test(e)) {
		let t = `Anchor must not contain whitespace or control characters: ${JSON.stringify(e)}`;
		throw Error(t);
	}
	return !0;
}
function el(e) {
	let t = /* @__PURE__ */ new Set();
	return Gc(e, { Value(e, n) {
		n.anchor && t.add(n.anchor);
	} }), t;
}
function tl(e, t) {
	for (let n = 1;; ++n) {
		let r = `${e}${n}`;
		if (!t.has(r)) return r;
	}
}
function nl(e, t) {
	let n = [], r = /* @__PURE__ */ new Map(), i = null;
	return {
		onAnchor: (r) => {
			n.push(r), i ??= el(e);
			let a = tl(t, i);
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
function rl(e, t, n, r) {
	if (r && typeof r == "object") {
		if (Array.isArray(r)) for (let t = 0, n = r.length; t < n; ++t) {
			let n = r[t], i = rl(e, r, String(t), n);
			i === void 0 ? delete r[t] : i !== n && (r[t] = i);
		}
		else if (r instanceof Map) for (let t of Array.from(r.keys())) {
			let n = r.get(t), i = rl(e, r, t, n);
			i === void 0 ? r.delete(t) : i !== n && r.set(t, i);
		}
		else if (r instanceof Set) for (let t of Array.from(r)) {
			let n = rl(e, r, t, t);
			n === void 0 ? r.delete(t) : n !== t && (r.delete(t), r.add(n));
		}
		else for (let [t, n] of Object.entries(r)) {
			let i = rl(e, r, t, n);
			i === void 0 ? delete r[t] : i !== n && (r[t] = i);
		}
	}
	return e.call(t, n, r);
}
// node_modules/yaml/browser/dist/nodes/toJS.js
function U(e, t, n) {
	if (Array.isArray(e)) return e.map((e, t) => U(e, String(t), n));
	if (e && typeof e.toJSON == "function") {
		if (!n || !Vc(e)) return e.toJSON(t, n);
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
var il = class {
	constructor(e) {
		Object.defineProperty(this, R, { value: e });
	}
	clone() {
		let e = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
		return this.range && (e.range = this.range.slice()), e;
	}
	toJS(e, { mapAsMap: t, maxAliasCount: n, onAnchor: r, reviver: i } = {}) {
		if (!Rc(e)) throw TypeError("A document argument is required");
		let a = {
			anchors: /* @__PURE__ */ new Map(),
			doc: e,
			keep: !0,
			mapAsMap: t === !0,
			mapKeyWarned: !1,
			maxAliasCount: typeof n == "number" ? n : 100
		}, o = U(this, "", a);
		if (typeof r == "function") for (let { count: e, res: t } of a.anchors.values()) r(t, e);
		return typeof i == "function" ? rl(i, { "": o }, "", o) : o;
	}
}, al = class extends il {
	constructor(e) {
		super(jc), this.source = e, Object.defineProperty(this, "tag", { set() {
			throw Error("Alias nodes cannot have tags");
		} });
	}
	resolve(e, t) {
		if (t?.maxAliasCount === 0) throw ReferenceError("Alias resolution is disabled");
		let n;
		t?.aliasResolveCache ? n = t.aliasResolveCache : (n = [], Gc(e, { Node: (e, t) => {
			(Lc(t) || Vc(t)) && n.push(t);
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
			if (i >= 0 && (a.count += 1, a.aliasCount === 0 && (a.aliasCount = ol(n, r, e)), a.count * a.aliasCount > i)) throw ReferenceError("Excessive alias count indicates a resource exhaustion attack");
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
			if ($c(this.source), e.options.verifyAliasOrder && !e.anchors.has(this.source)) {
				let e = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
				throw Error(e);
			}
			if (e.implicitKey) return `${r} `;
		}
		return r;
	}
};
function ol(e, t, n) {
	if (Lc(t)) {
		let r = t.resolve(e), i = n && r && n.get(r);
		return i ? i.count * i.aliasCount : 0;
	}
	if (V(t)) {
		let r = 0;
		for (let i of t.items) {
			let t = ol(e, i, n);
			t > r && (r = t);
		}
		return r;
	}
	if (z(t)) {
		let r = ol(e, t.key, n), i = ol(e, t.value, n);
		return Math.max(r, i);
	}
	return 1;
}
// node_modules/yaml/browser/dist/nodes/Scalar.js
var sl = (e) => !e || typeof e != "function" && typeof e != "object", W = class extends il {
	constructor(e) {
		super(Fc), this.value = e;
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
var cl = "tag:yaml.org,2002:";
function ll(e, t, n) {
	if (t) {
		let e = n.filter((e) => e.tag === t), r = e.find((e) => !e.format) ?? e[0];
		if (!r) throw Error(`Tag ${t} not found`);
		return r;
	}
	return n.find((t) => t.identify?.(e) && !t.format);
}
function ul(e, t, n) {
	if (Rc(e) && (e = e.contents), H(e)) return e;
	if (z(e)) {
		let t = n.schema[Nc].createNode?.(n.schema, null, n);
		return t.items.push(e), t;
	}
	(e instanceof String || e instanceof Number || e instanceof Boolean || typeof BigInt < "u" && e instanceof BigInt) && (e = e.valueOf());
	let { aliasDuplicateObjects: r, onAnchor: i, onTagObj: a, schema: o, sourceObjects: s } = n, c;
	if (r && e && typeof e == "object") {
		if (c = s.get(e), c) return c.anchor ?? (c.anchor = i(e)), new al(c.anchor);
		c = {
			anchor: null,
			node: null
		}, s.set(e, c);
	}
	t?.startsWith("!!") && (t = cl + t.slice(2));
	let l = ll(e, t, o.tags);
	if (!l) {
		if (e && typeof e.toJSON == "function" && (e = e.toJSON()), !e || typeof e != "object") {
			let t = new W(e);
			return c && (c.node = t), t;
		}
		l = e instanceof Map ? o[Nc] : Symbol.iterator in Object(e) ? o[Ic] : o[Nc];
	}
	a && (a(l), delete n.onTagObj);
	let u = l?.createNode ? l.createNode(n.schema, e, n) : typeof l?.nodeClass?.from == "function" ? l.nodeClass.from(n.schema, e, n) : new W(e);
	return t ? u.tag = t : l.default || (u.tag = l.tag), c && (c.node = u), u;
}
// node_modules/yaml/browser/dist/nodes/Collection.js
function dl(e, t, n) {
	let r = n;
	for (let e = t.length - 1; e >= 0; --e) {
		let n = t[e];
		if (typeof n == "number" && Number.isInteger(n) && n >= 0) {
			let e = [];
			e[n] = r, r = e;
		} else r = /* @__PURE__ */ new Map([[n, r]]);
	}
	return ul(r, void 0, {
		aliasDuplicateObjects: !1,
		keepUndefined: !1,
		onAnchor: () => {
			throw Error("This should not happen, please report a bug.");
		},
		schema: e,
		sourceObjects: /* @__PURE__ */ new Map()
	});
}
var fl = (e) => e == null || typeof e == "object" && !!e[Symbol.iterator]().next().done, pl = class extends il {
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
		if (fl(e)) this.add(t);
		else {
			let [n, ...r] = e, i = this.get(n, !0);
			if (V(i)) i.addIn(r, t);
			else if (i === void 0 && this.schema) this.set(n, dl(this.schema, r, t));
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
			else if (e === void 0 && this.schema) this.set(n, dl(this.schema, r, t));
			else throw Error(`Expected YAML collection at ${n}. Remaining path: ${r}`);
		}
	}
}, ml = (e) => e.replace(/^(?!$)(?: $)?/gm, "#");
function hl(e, t) {
	return /^\n+$/.test(e) ? e.substring(1) : t ? e.replace(/^(?! *$)/gm, t) : e;
}
var gl = (e, t, n) => e.endsWith("\n") ? hl(n, t) : n.includes("\n") ? "\n" + hl(n, t) : (e.endsWith(" ") ? "" : " ") + n, _l = "flow", vl = "block", yl = "quoted";
function bl(e, t, n = "flow", { indentAtStart: r, lineWidth: i = 80, minContentWidth: a = 20, onFold: o, onOverflow: s } = {}) {
	if (!i || i < 0) return e;
	i < a && (a = 0);
	let c = Math.max(1 + a, 1 + i - t.length);
	if (e.length <= c) return e;
	let l = [], u = {}, d = i - t.length;
	typeof r == "number" && (r > i - Math.max(2, a) ? l.push(0) : d = i - r);
	let f, p, m = !1, h = -1, g = -1, _ = -1;
	n === "block" && (h = xl(e, h, t.length), h !== -1 && (d = h + c));
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
		if (r === "\n") n === "block" && (h = xl(e, h, t.length)), d = h + t.length + c, f = void 0;
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
function xl(e, t, n) {
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
var Sl = (e, t) => ({
	indentAtStart: t ? e.indent.length : e.indentAtStart,
	lineWidth: e.options.lineWidth,
	minContentWidth: e.options.minContentWidth
}), Cl = (e) => /^(%|---|\.\.\.)/m.test(e);
function wl(e, t, n) {
	if (!t || t < 0) return !1;
	let r = t - n, i = e.length;
	if (i <= r) return !1;
	for (let t = 0, n = 0; t < i; ++t) if (e[t] === "\n") {
		if (t - n > r) return !0;
		if (n = t + 1, i - n <= r) return !1;
	}
	return !0;
}
function Tl(e, t) {
	let n = JSON.stringify(e);
	if (t.options.doubleQuotedAsJSON) return n;
	let { implicitKey: r } = t, i = t.options.doubleQuotedMinMultiLineLength, a = t.indent || (Cl(e) ? "  " : ""), o = "", s = 0;
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
	return o = s ? o + n.slice(s) : n, r ? o : bl(o, a, yl, Sl(t, !1));
}
function El(e, t) {
	if (t.options.singleQuote === !1 || t.implicitKey && e.includes("\n") || /[ \t]\n|\n[ \t]/.test(e)) return Tl(e, t);
	let n = t.indent || (Cl(e) ? "  " : ""), r = "'" + e.replace(/'/g, "''").replace(/\n+/g, `$&\n${n}`) + "'";
	return t.implicitKey ? r : bl(r, n, _l, Sl(t, !1));
}
function Dl(e, t) {
	let { singleQuote: n } = t.options, r;
	if (n === !1) r = Tl;
	else {
		let t = e.includes("\""), i = e.includes("'");
		r = t && !i ? El : i && !t ? Tl : n ? El : Tl;
	}
	return r(e, t);
}
var Ol;
try {
	Ol = /* @__PURE__ */ RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
} catch {
	Ol = /\n+(?!\n|$)/g;
}
function kl({ comment: e, type: t, value: n }, r, i, a) {
	let { blockQuote: o, commentString: s, lineWidth: c } = r.options;
	if (!o || /\n[\t ]+$/.test(n)) return Dl(n, r);
	let l = r.indent || (r.forceBlockIndent || Cl(n) ? "  " : ""), u = o === "literal" ? !0 : o === "folded" || t === W.BLOCK_FOLDED ? !1 : t === W.BLOCK_LITERAL || !wl(n, c, l.length);
	if (!n) return u ? "|\n" : ">\n";
	let d, f;
	for (f = n.length; f > 0; --f) {
		let e = n[f - 1];
		if (e !== "\n" && e !== "	" && e !== " ") break;
	}
	let p = n.substring(f), m = p.indexOf("\n");
	m === -1 ? d = "-" : n === p || m !== p.length - 1 ? (d = "+", a && a()) : d = "", p &&= (n = n.slice(0, -p.length), p[p.length - 1] === "\n" && (p = p.slice(0, -1)), p.replace(Ol, `$&${l}`));
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
		let e = n.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${l}`), i = !1, a = Sl(r, !0);
		o !== "folded" && t !== W.BLOCK_FOLDED && (a.onOverflow = () => {
			i = !0;
		});
		let s = bl(`${v}${e}${p}`, l, vl, a);
		if (!i) return `>${y}\n${l}${s}`;
	}
	return n = n.replace(/\n+/g, `$&${l}`), `|${y}\n${l}${v}${n}${p}`;
}
function Al(e, t, n, r) {
	let { type: i, value: a } = e, { actualString: o, implicitKey: s, indent: c, indentStep: l, inFlow: u } = t;
	if (s && a.includes("\n") || u && /[[\]{},]/.test(a)) return Dl(a, t);
	if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(a)) return s || u || !a.includes("\n") ? Dl(a, t) : kl(e, t, n, r);
	if (!s && !u && i !== W.PLAIN && a.includes("\n")) return kl(e, t, n, r);
	if (Cl(a)) {
		if (c === "") return t.forceBlockIndent = !0, kl(e, t, n, r);
		if (s && c === l) return Dl(a, t);
	}
	let d = a.replace(/\n+/g, `$&\n${c}`);
	if (o) {
		let e = (e) => e.default && e.tag !== "tag:yaml.org,2002:str" && e.test?.test(d), { compat: n, tags: r } = t.doc.schema;
		if (r.some(e) || n?.some(e)) return Dl(a, t);
	}
	return s ? d : bl(d, c, _l, Sl(t, !1));
}
function jl(e, t, n, r) {
	let { implicitKey: i, inFlow: a } = t, o = typeof e.value == "string" ? e : Object.assign({}, e, { value: String(e.value) }), { type: s } = e;
	s !== W.QUOTE_DOUBLE && /[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(o.value) && (s = W.QUOTE_DOUBLE);
	let c = (e) => {
		switch (e) {
			case W.BLOCK_FOLDED:
			case W.BLOCK_LITERAL: return i || a ? Dl(o.value, t) : kl(o, t, n, r);
			case W.QUOTE_DOUBLE: return Tl(o.value, t);
			case W.QUOTE_SINGLE: return El(o.value, t);
			case W.PLAIN: return Al(o, t, n, r);
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
function Ml(e, t) {
	let n = Object.assign({
		blockQuote: !0,
		commentString: ml,
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
function Nl(e, t) {
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
function Pl(e, t, { anchors: n, doc: r }) {
	if (!r.directives) return "";
	let i = [], a = (B(e) || V(e)) && e.anchor;
	a && $c(a) && (n.add(a), i.push(`&${a}`));
	let o = e.tag ?? (t.default ? null : t.tag);
	return o && i.push(r.directives.tagString(o)), i.join(" ");
}
function Fl(e, t, n, r) {
	if (z(e)) return e.toString(t, n, r);
	if (Lc(e)) {
		if (t.doc.directives) return e.toString(t);
		if (t.resolvedAliases?.has(e)) throw TypeError("Cannot stringify circular structure without alias nodes");
		t.resolvedAliases ? t.resolvedAliases.add(e) : t.resolvedAliases = /* @__PURE__ */ new Set([e]), e = e.resolve(t.doc);
	}
	let i, a = H(e) ? e : t.doc.createNode(e, { onTagObj: (e) => i = e });
	i ??= Nl(t.doc.schema.tags, a);
	let o = Pl(a, i, t);
	o.length > 0 && (t.indentAtStart = (t.indentAtStart ?? 0) + o.length + 1);
	let s = typeof i.stringify == "function" ? i.stringify(a, t, n, r) : B(a) ? jl(a, t, n, r) : a.toString(t, n, r);
	return o ? B(a) || s[0] === "{" || s[0] === "[" ? `${o} ${s}` : `${o}\n${t.indent}${s}` : s;
}
// node_modules/yaml/browser/dist/stringify/stringifyPair.js
function Il({ key: e, value: t }, n, r, i) {
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
	let m = !1, h = !1, g = Fl(e, n, () => m = !0, () => h = !0);
	if (!p && !n.inFlow && g.length > 1024) {
		if (d) throw Error("With simple keys, single line scalar must not span more than 1024 characters");
		p = !0;
	}
	if (n.inFlow) {
		if (a || t == null) return m && r && r(), g === "" ? "?" : p ? `? ${g}` : g;
	} else if (a && !d || t == null && p) return g = `? ${g}`, f && !m ? g += gl(g, n.indent, l(f)) : h && i && i(), g;
	m && (f = null), p ? (f && (g += gl(g, n.indent, l(f))), g = `? ${g}\n${s}:`) : (g = `${g}:`, f && (g += gl(g, n.indent, l(f))));
	let _, v, y;
	H(t) ? (_ = !!t.spaceBefore, v = t.commentBefore, y = t.comment) : (_ = !1, v = null, y = null, t && typeof t == "object" && (t = o.createNode(t))), n.implicitKey = !1, !p && !f && B(t) && (n.indentAtStart = g.length + 1), h = !1, !u && c.length >= 2 && !n.inFlow && !p && Bc(t) && !t.flow && !t.tag && !t.anchor && (n.indent = n.indent.substring(2));
	let ee = !1, b = Fl(t, n, () => ee = !0, () => h = !0), x = " ";
	if (f || _ || v) {
		if (x = _ ? "\n" : "", v) {
			let e = l(v);
			x += `\n${hl(e, n.indent)}`;
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
	return g += x + b, n.inFlow ? ee && r && r() : y && !ee ? g += gl(g, n.indent, l(y)) : h && i && i(), g;
}
// node_modules/yaml/browser/dist/log.js
function Ll(e, t) {
	(e === "debug" || e === "warn") && console.warn(t);
}
// node_modules/yaml/browser/dist/schema/yaml-1.1/merge.js
var Rl = "<<", zl = {
	identify: (e) => e === Rl || typeof e == "symbol" && e.description === Rl,
	default: "key",
	tag: "tag:yaml.org,2002:merge",
	test: /^<<$/,
	resolve: () => Object.assign(new W(Symbol(Rl)), { addToJSMap: Vl }),
	stringify: () => Rl
}, Bl = (e, t) => (zl.identify(t) || B(t) && (!t.type || t.type === W.PLAIN) && zl.identify(t.value)) && e?.doc.schema.tags.some((e) => e.tag === zl.tag && e.default);
function Vl(e, t, n) {
	let r = Ul(e, n);
	if (Bc(r)) for (let n of r.items) Hl(e, t, n);
	else if (Array.isArray(r)) for (let n of r) Hl(e, t, n);
	else Hl(e, t, r);
}
function Hl(e, t, n) {
	let r = Ul(e, n);
	if (!zc(r)) throw Error("Merge sources must be maps or map aliases");
	let i = r.toJSON(null, e, Map);
	for (let [e, n] of i) t instanceof Map ? t.has(e) || t.set(e, n) : t instanceof Set ? t.add(e) : Object.prototype.hasOwnProperty.call(t, e) || Object.defineProperty(t, e, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
	return t;
}
function Ul(e, t) {
	return e && Lc(t) ? t.resolve(e.doc, e) : t;
}
// node_modules/yaml/browser/dist/nodes/addPairToJSMap.js
function Wl(e, t, { key: n, value: r }) {
	if (H(n) && n.addToJSMap) n.addToJSMap(e, t, r);
	else if (Bl(e, n)) Vl(e, t, r);
	else {
		let i = U(n, "", e);
		if (t instanceof Map) t.set(i, U(r, i, e));
		else if (t instanceof Set) t.add(i);
		else {
			let a = Gl(n, i, e), o = U(r, a, e);
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
function Gl(e, t, n) {
	if (t === null) return "";
	if (typeof t != "object") return String(t);
	if (H(e) && n?.doc) {
		let t = Ml(n.doc, {});
		t.anchors = /* @__PURE__ */ new Set();
		for (let e of n.anchors.keys()) t.anchors.add(e.anchor);
		t.inFlow = !0, t.inStringifyKey = !0;
		let r = e.toString(t);
		if (!n.mapKeyWarned) {
			let e = JSON.stringify(r);
			e.length > 40 && (e = e.substring(0, 36) + "...\""), Ll(n.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${e}. Set mapAsMap: true to use object keys.`), n.mapKeyWarned = !0;
		}
		return r;
	}
	return JSON.stringify(t);
}
// node_modules/yaml/browser/dist/nodes/Pair.js
function Kl(e, t, n) {
	return new G(ul(e, void 0, n), ul(t, void 0, n));
}
var G = class e {
	constructor(e, t = null) {
		Object.defineProperty(this, R, { value: Pc }), this.key = e, this.value = t;
	}
	clone(t) {
		let { key: n, value: r } = this;
		return H(n) && (n = n.clone(t)), H(r) && (r = r.clone(t)), new e(n, r);
	}
	toJSON(e, t) {
		return Wl(t, t?.mapAsMap ? /* @__PURE__ */ new Map() : {}, this);
	}
	toString(e, t, n) {
		return e?.doc ? Il(this, e, t, n) : JSON.stringify(this);
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyCollection.js
function ql(e, t, n) {
	return (t.inFlow ?? e.flow ? Yl : Jl)(e, t, n);
}
function Jl({ comment: e, items: t }, n, { blockItemPrefix: r, flowChars: i, itemIndent: a, onChompKeep: o, onComment: s }) {
	let { indent: c, options: { commentString: l } } = n, u = Object.assign({}, n, {
		indent: a,
		type: null
	}), d = !1, f = [];
	for (let e = 0; e < t.length; ++e) {
		let i = t[e], o = null;
		if (H(i)) !d && i.spaceBefore && f.push(""), Xl(n, f, i.commentBefore, d), i.comment && (o = i.comment);
		else if (z(i)) {
			let e = H(i.key) ? i.key : null;
			e && (!d && e.spaceBefore && f.push(""), Xl(n, f, e.commentBefore, d));
		}
		d = !1;
		let s = Fl(i, u, () => o = null, () => d = !0);
		o && (s += gl(s, a, l(o))), d && o && (d = !1), f.push(r + s);
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
	return e ? (p += "\n" + hl(l(e), c), s && s()) : d && o && o(), p;
}
function Yl({ items: e }, t, { flowChars: n, itemIndent: r }) {
	let { indent: i, indentStep: a, flowCollectionPadding: o, options: { commentString: s } } = t;
	r += a;
	let c = Object.assign({}, t, {
		indent: r,
		inFlow: !0,
		type: null
	}), l = !1, u = 0, d = [];
	for (let n = 0; n < e.length; ++n) {
		let i = e[n], a = null;
		if (H(i)) i.spaceBefore && d.push(""), Xl(t, d, i.commentBefore, !1), i.comment && (a = i.comment);
		else if (z(i)) {
			let e = H(i.key) ? i.key : null;
			e && (e.spaceBefore && d.push(""), Xl(t, d, e.commentBefore, !1), e.comment && (l = !0));
			let n = H(i.value) ? i.value : null;
			n ? (n.comment && (a = n.comment), n.commentBefore && (l = !0)) : i.value == null && e?.comment && (a = e.comment);
		}
		a && (l = !0);
		let o = Fl(i, c, () => a = null);
		l ||= d.length > u || o.includes("\n"), n < e.length - 1 ? o += "," : t.options.trailingComma && (t.options.lineWidth > 0 && (l ||= d.reduce((e, t) => e + t.length + 2, 2) + (o.length + 2) > t.options.lineWidth), l && (o += ",")), a && (o += gl(o, r, s(a))), d.push(o), u = d.length;
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
function Xl({ indent: e, options: { commentString: t } }, n, r, i) {
	if (r && i && (r = r.replace(/^\n+/, "")), r) {
		let i = hl(t(r), e);
		n.push(i.trimStart());
	}
}
// node_modules/yaml/browser/dist/nodes/YAMLMap.js
function Zl(e, t) {
	let n = B(t) ? t.value : t;
	for (let r of e) if (z(r) && (r.key === t || r.key === n || B(r.key) && r.key.value === n)) return r;
}
var K = class extends pl {
	static get tagName() {
		return "tag:yaml.org,2002:map";
	}
	constructor(e) {
		super(Nc, e), this.items = [];
	}
	static from(e, t, n) {
		let { keepUndefined: r, replacer: i } = n, a = new this(e), o = (e, o) => {
			if (typeof i == "function") o = i.call(t, e, o);
			else if (Array.isArray(i) && !i.includes(e)) return;
			(o !== void 0 || r) && a.items.push(Kl(e, o, n));
		};
		if (t instanceof Map) for (let [e, n] of t) o(e, n);
		else if (t && typeof t == "object") for (let e of Object.keys(t)) o(e, t[e]);
		return typeof e.sortMapEntries == "function" && a.items.sort(e.sortMapEntries), a;
	}
	add(e, t) {
		let n;
		n = z(e) ? e : !e || typeof e != "object" || !("key" in e) ? new G(e, e?.value) : new G(e.key, e.value);
		let r = Zl(this.items, n.key), i = this.schema?.sortMapEntries;
		if (r) {
			if (!t) throw Error(`Key ${n.key} already set`);
			B(r.value) && sl(n.value) ? r.value.value = n.value : r.value = n.value;
		} else if (i) {
			let e = this.items.findIndex((e) => i(n, e) < 0);
			e === -1 ? this.items.push(n) : this.items.splice(e, 0, n);
		} else this.items.push(n);
	}
	delete(e) {
		let t = Zl(this.items, e);
		return t ? this.items.splice(this.items.indexOf(t), 1).length > 0 : !1;
	}
	get(e, t) {
		let n = Zl(this.items, e)?.value;
		return (!t && B(n) ? n.value : n) ?? void 0;
	}
	has(e) {
		return !!Zl(this.items, e);
	}
	set(e, t) {
		this.add(new G(e, t), !0);
	}
	toJSON(e, t, n) {
		let r = n ? new n() : t?.mapAsMap ? /* @__PURE__ */ new Map() : {};
		t?.onCreate && t.onCreate(r);
		for (let e of this.items) Wl(t, r, e);
		return r;
	}
	toString(e, t, n) {
		if (!e) return JSON.stringify(this);
		for (let e of this.items) if (!z(e)) throw Error(`Map items must all be pairs; found ${JSON.stringify(e)} instead`);
		return !e.allNullValues && this.hasAllNullValues(!1) && (e = Object.assign({}, e, { allNullValues: !0 })), ql(this, e, {
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
}, Ql = {
	collection: "map",
	default: !0,
	nodeClass: K,
	tag: "tag:yaml.org,2002:map",
	resolve(e, t) {
		return zc(e) || t("Expected a mapping for this tag"), e;
	},
	createNode: (e, t, n) => K.from(e, t, n)
}, $l = class extends pl {
	static get tagName() {
		return "tag:yaml.org,2002:seq";
	}
	constructor(e) {
		super(Ic, e), this.items = [];
	}
	add(e) {
		this.items.push(e);
	}
	delete(e) {
		let t = eu(e);
		return typeof t == "number" && this.items.splice(t, 1).length > 0;
	}
	get(e, t) {
		let n = eu(e);
		if (typeof n != "number") return;
		let r = this.items[n];
		return !t && B(r) ? r.value : r;
	}
	has(e) {
		let t = eu(e);
		return typeof t == "number" && t < this.items.length;
	}
	set(e, t) {
		let n = eu(e);
		if (typeof n != "number") throw Error(`Expected a valid index, not ${e}.`);
		let r = this.items[n];
		B(r) && sl(t) ? r.value = t : this.items[n] = t;
	}
	toJSON(e, t) {
		let n = [];
		t?.onCreate && t.onCreate(n);
		let r = 0;
		for (let e of this.items) n.push(U(e, String(r++), t));
		return n;
	}
	toString(e, t, n) {
		return e ? ql(this, e, {
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
				i.items.push(ul(a, void 0, n));
			}
		}
		return i;
	}
};
function eu(e) {
	let t = B(e) ? e.value : e;
	return t && typeof t == "string" && (t = Number(t)), typeof t == "number" && Number.isInteger(t) && t >= 0 ? t : null;
}
// node_modules/yaml/browser/dist/schema/common/seq.js
var tu = {
	collection: "seq",
	default: !0,
	nodeClass: $l,
	tag: "tag:yaml.org,2002:seq",
	resolve(e, t) {
		return Bc(e) || t("Expected a sequence for this tag"), e;
	},
	createNode: (e, t, n) => $l.from(e, t, n)
}, nu = {
	identify: (e) => typeof e == "string",
	default: !0,
	tag: "tag:yaml.org,2002:str",
	resolve: (e) => e,
	stringify(e, t, n, r) {
		return t = Object.assign({ actualString: !0 }, t), jl(e, t, n, r);
	}
}, ru = {
	identify: (e) => e == null,
	createNode: () => new W(null),
	default: !0,
	tag: "tag:yaml.org,2002:null",
	test: /^(?:~|[Nn]ull|NULL)?$/,
	resolve: () => new W(null),
	stringify: ({ source: e }, t) => typeof e == "string" && ru.test.test(e) ? e : t.options.nullStr
}, iu = {
	identify: (e) => typeof e == "boolean",
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
	resolve: (e) => new W(e[0] === "t" || e[0] === "T"),
	stringify({ source: e, value: t }, n) {
		return e && iu.test.test(e) && t === (e[0] === "t" || e[0] === "T") ? e : t ? n.options.trueStr : n.options.falseStr;
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyNumber.js
function q({ format: e, minFractionDigits: t, tag: n, value: r }) {
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
var au = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
	resolve: (e) => e.slice(-3).toLowerCase() === "nan" ? NaN : e[0] === "-" ? -Infinity : Infinity,
	stringify: q
}, ou = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "EXP",
	test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
	resolve: (e) => parseFloat(e),
	stringify(e) {
		let t = Number(e.value);
		return isFinite(t) ? t.toExponential() : q(e);
	}
}, su = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
	resolve(e) {
		let t = new W(parseFloat(e)), n = e.indexOf(".");
		return n !== -1 && e[e.length - 1] === "0" && (t.minFractionDigits = e.length - n - 1), t;
	},
	stringify: q
}, cu = (e) => typeof e == "bigint" || Number.isInteger(e), lu = (e, t, n, { intAsBigInt: r }) => r ? BigInt(e) : parseInt(e.substring(t), n);
function uu(e, t, n) {
	let { value: r } = e;
	return cu(r) && r >= 0 ? n + r.toString(t) : q(e);
}
var du = {
	identify: (e) => cu(e) && e >= 0,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "OCT",
	test: /^0o[0-7]+$/,
	resolve: (e, t, n) => lu(e, 2, 8, n),
	stringify: (e) => uu(e, 8, "0o")
}, fu = {
	identify: cu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	test: /^[-+]?[0-9]+$/,
	resolve: (e, t, n) => lu(e, 0, 10, n),
	stringify: q
}, pu = {
	identify: (e) => cu(e) && e >= 0,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "HEX",
	test: /^0x[0-9a-fA-F]+$/,
	resolve: (e, t, n) => lu(e, 2, 16, n),
	stringify: (e) => uu(e, 16, "0x")
}, mu = [
	Ql,
	tu,
	nu,
	ru,
	iu,
	du,
	fu,
	pu,
	au,
	ou,
	su
];
// node_modules/yaml/browser/dist/schema/json/schema.js
function hu(e) {
	return typeof e == "bigint" || Number.isInteger(e);
}
var gu = ({ value: e }) => JSON.stringify(e), _u = [
	{
		identify: (e) => typeof e == "string",
		default: !0,
		tag: "tag:yaml.org,2002:str",
		resolve: (e) => e,
		stringify: gu
	},
	{
		identify: (e) => e == null,
		createNode: () => new W(null),
		default: !0,
		tag: "tag:yaml.org,2002:null",
		test: /^null$/,
		resolve: () => null,
		stringify: gu
	},
	{
		identify: (e) => typeof e == "boolean",
		default: !0,
		tag: "tag:yaml.org,2002:bool",
		test: /^true$|^false$/,
		resolve: (e) => e === "true",
		stringify: gu
	},
	{
		identify: hu,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		test: /^-?(?:0|[1-9][0-9]*)$/,
		resolve: (e, t, { intAsBigInt: n }) => n ? BigInt(e) : parseInt(e, 10),
		stringify: ({ value: e }) => hu(e) ? e.toString() : JSON.stringify(e)
	},
	{
		identify: (e) => typeof e == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
		resolve: (e) => parseFloat(e),
		stringify: gu
	}
], vu = [Ql, tu].concat(_u, {
	default: !0,
	tag: "",
	test: /^/,
	resolve(e, t) {
		return t(`Unresolved plain scalar ${JSON.stringify(e)}`), e;
	}
}), yu = {
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
		return jl({
			comment: e,
			type: t,
			value: s
		}, r, i, a);
	}
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/pairs.js
function bu(e, t) {
	if (Bc(e)) for (let n = 0; n < e.items.length; ++n) {
		let r = e.items[n];
		if (!z(r)) {
			if (zc(r)) {
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
function xu(e, t, n) {
	let { replacer: r } = n, i = new $l(e);
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
		i.items.push(Kl(o, s, n));
	}
	return i;
}
var Su = {
	collection: "seq",
	default: !1,
	tag: "tag:yaml.org,2002:pairs",
	resolve: bu,
	createNode: xu
}, Cu = class e extends $l {
	constructor() {
		super(), this.add = K.prototype.add.bind(this), this.delete = K.prototype.delete.bind(this), this.get = K.prototype.get.bind(this), this.has = K.prototype.has.bind(this), this.set = K.prototype.set.bind(this), this.tag = e.tag;
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
		let r = xu(e, t, n), i = new this();
		return i.items = r.items, i;
	}
};
Cu.tag = "tag:yaml.org,2002:omap";
var wu = {
	collection: "seq",
	identify: (e) => e instanceof Map,
	nodeClass: Cu,
	default: !1,
	tag: "tag:yaml.org,2002:omap",
	resolve(e, t) {
		let n = bu(e, t), r = [];
		for (let { key: e } of n.items) B(e) && (r.includes(e.value) ? t(`Ordered maps must not include duplicate keys: ${e.value}`) : r.push(e.value));
		return Object.assign(new Cu(), n);
	},
	createNode: (e, t, n) => Cu.from(e, t, n)
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/bool.js
function Tu({ value: e, source: t }, n) {
	return t && (e ? Eu : Du).test.test(t) ? t : e ? n.options.trueStr : n.options.falseStr;
}
var Eu = {
	identify: (e) => e === !0,
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
	resolve: () => new W(!0),
	stringify: Tu
}, Du = {
	identify: (e) => e === !1,
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
	resolve: () => new W(!1),
	stringify: Tu
}, Ou = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
	resolve: (e) => e.slice(-3).toLowerCase() === "nan" ? NaN : e[0] === "-" ? -Infinity : Infinity,
	stringify: q
}, ku = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "EXP",
	test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
	resolve: (e) => parseFloat(e.replace(/_/g, "")),
	stringify(e) {
		let t = Number(e.value);
		return isFinite(t) ? t.toExponential() : q(e);
	}
}, Au = {
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
	stringify: q
}, ju = (e) => typeof e == "bigint" || Number.isInteger(e);
function Mu(e, t, n, { intAsBigInt: r }) {
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
function Nu(e, t, n) {
	let { value: r } = e;
	if (ju(r)) {
		let e = r.toString(t);
		return r < 0 ? "-" + n + e.substr(1) : n + e;
	}
	return q(e);
}
var Pu = {
	identify: ju,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "BIN",
	test: /^[-+]?0b[0-1_]+$/,
	resolve: (e, t, n) => Mu(e, 2, 2, n),
	stringify: (e) => Nu(e, 2, "0b")
}, Fu = {
	identify: ju,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "OCT",
	test: /^[-+]?0[0-7_]+$/,
	resolve: (e, t, n) => Mu(e, 1, 8, n),
	stringify: (e) => Nu(e, 8, "0")
}, Iu = {
	identify: ju,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	test: /^[-+]?[0-9][0-9_]*$/,
	resolve: (e, t, n) => Mu(e, 0, 10, n),
	stringify: q
}, Lu = {
	identify: ju,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "HEX",
	test: /^[-+]?0x[0-9a-fA-F_]+$/,
	resolve: (e, t, n) => Mu(e, 2, 16, n),
	stringify: (e) => Nu(e, 16, "0x")
}, Ru = class e extends K {
	constructor(t) {
		super(t), this.tag = e.tag;
	}
	add(e) {
		let t;
		t = z(e) ? e : e && typeof e == "object" && "key" in e && "value" in e && e.value === null ? new G(e.key, null) : new G(e, null), Zl(this.items, t.key) || this.items.push(t);
	}
	get(e, t) {
		let n = Zl(this.items, e);
		return !t && z(n) ? B(n.key) ? n.key.value : n.key : n;
	}
	set(e, t) {
		if (typeof t != "boolean") throw Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof t}`);
		let n = Zl(this.items, e);
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
		if (t && Symbol.iterator in Object(t)) for (let e of t) typeof r == "function" && (e = r.call(t, e, e)), i.items.push(Kl(e, null, n));
		return i;
	}
};
Ru.tag = "tag:yaml.org,2002:set";
var zu = {
	collection: "map",
	identify: (e) => e instanceof Set,
	nodeClass: Ru,
	default: !1,
	tag: "tag:yaml.org,2002:set",
	createNode: (e, t, n) => Ru.from(e, t, n),
	resolve(e, t) {
		if (zc(e)) {
			if (e.hasAllNullValues(!0)) return Object.assign(new Ru(), e);
			t("Set items must all have null values");
		} else t("Expected a mapping for this tag");
		return e;
	}
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/timestamp.js
function Bu(e, t) {
	let n = e[0], r = n === "-" || n === "+" ? e.substring(1) : e, i = (e) => t ? BigInt(e) : Number(e), a = r.replace(/_/g, "").split(":").reduce((e, t) => e * i(60) + i(t), i(0));
	return n === "-" ? i(-1) * a : a;
}
function Vu(e) {
	let { value: t } = e, n = (e) => e;
	if (typeof t == "bigint") n = (e) => BigInt(e);
	else if (isNaN(t) || !isFinite(t)) return q(e);
	let r = "";
	t < 0 && (r = "-", t *= n(-1));
	let i = n(60), a = [t % i];
	return t < 60 ? a.unshift(0) : (t = (t - a[0]) / i, a.unshift(t % i), t >= 60 && (t = (t - a[0]) / i, a.unshift(t))), r + a.map((e) => String(e).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
}
var Hu = {
	identify: (e) => typeof e == "bigint" || Number.isInteger(e),
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "TIME",
	test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
	resolve: (e, t, { intAsBigInt: n }) => Bu(e, n),
	stringify: Vu
}, Uu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "TIME",
	test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
	resolve: (e) => Bu(e, !1),
	stringify: Vu
}, Wu = {
	identify: (e) => e instanceof Date,
	default: !0,
	tag: "tag:yaml.org,2002:timestamp",
	test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
	resolve(e) {
		let t = e.match(Wu.test);
		if (!t) throw Error("!!timestamp expects a date, starting with yyyy-mm-dd");
		let [, n, r, i, a, o, s] = t.map(Number), c = t[7] ? Number((t[7] + "00").substr(1, 3)) : 0, l = Date.UTC(n, r - 1, i, a || 0, o || 0, s || 0, c), u = t[8];
		if (u && u !== "Z") {
			let e = Bu(u, !1);
			Math.abs(e) < 30 && (e *= 60), l -= 6e4 * e;
		}
		return new Date(l);
	},
	stringify: ({ value: e }) => e?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
}, Gu = [
	Ql,
	tu,
	nu,
	ru,
	Eu,
	Du,
	Pu,
	Fu,
	Iu,
	Lu,
	Ou,
	ku,
	Au,
	yu,
	zl,
	wu,
	Su,
	zu,
	Hu,
	Uu,
	Wu
], Ku = /* @__PURE__ */ new Map([
	["core", mu],
	["failsafe", [
		Ql,
		tu,
		nu
	]],
	["json", vu],
	["yaml11", Gu],
	["yaml-1.1", Gu]
]), qu = {
	binary: yu,
	bool: iu,
	float: su,
	floatExp: ou,
	floatNaN: au,
	floatTime: Uu,
	int: fu,
	intHex: pu,
	intOct: du,
	intTime: Hu,
	map: Ql,
	merge: zl,
	null: ru,
	omap: wu,
	pairs: Su,
	seq: tu,
	set: zu,
	timestamp: Wu
}, Ju = {
	"tag:yaml.org,2002:binary": yu,
	"tag:yaml.org,2002:merge": zl,
	"tag:yaml.org,2002:omap": wu,
	"tag:yaml.org,2002:pairs": Su,
	"tag:yaml.org,2002:set": zu,
	"tag:yaml.org,2002:timestamp": Wu
};
function Yu(e, t, n) {
	let r = Ku.get(t);
	if (r && !e) return n && !r.includes(zl) ? r.concat(zl) : r.slice();
	let i = r;
	if (!i) {
		if (Array.isArray(e)) i = [];
		else {
			let e = Array.from(Ku.keys()).filter((e) => e !== "yaml11").map((e) => JSON.stringify(e)).join(", ");
			throw Error(`Unknown schema "${t}"; use one of ${e} or define customTags array`);
		}
	}
	if (Array.isArray(e)) for (let t of e) i = i.concat(t);
	else typeof e == "function" && (i = e(i.slice()));
	return n && (i = i.concat(zl)), i.reduce((e, t) => {
		let n = typeof t == "string" ? qu[t] : t;
		if (!n) {
			let e = JSON.stringify(t), n = Object.keys(qu).map((e) => JSON.stringify(e)).join(", ");
			throw Error(`Unknown custom tag ${e}; use one of ${n}`);
		}
		return e.includes(n) || e.push(n), e;
	}, []);
}
// node_modules/yaml/browser/dist/schema/Schema.js
var Xu = (e, t) => e.key < t.key ? -1 : +(e.key > t.key), Zu = class e {
	constructor({ compat: e, customTags: t, merge: n, resolveKnownTags: r, schema: i, sortMapEntries: a, toStringDefaults: o }) {
		this.compat = Array.isArray(e) ? Yu(e, "compat") : e ? Yu(null, e) : null, this.name = typeof i == "string" && i || "core", this.knownTags = r ? Ju : {}, this.tags = Yu(t, this.name, n), this.toStringOptions = o ?? null, Object.defineProperty(this, Nc, { value: Ql }), Object.defineProperty(this, Fc, { value: nu }), Object.defineProperty(this, Ic, { value: tu }), this.sortMapEntries = typeof a == "function" ? a : a === !0 ? Xu : null;
	}
	clone() {
		let t = Object.create(e.prototype, Object.getOwnPropertyDescriptors(this));
		return t.tags = this.tags.slice(), t;
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyDocument.js
function Qu(e, t) {
	let n = [], r = t.directives === !0;
	if (t.directives !== !1 && e.directives) {
		let t = e.directives.toString(e);
		t ? (n.push(t), r = !0) : e.directives.docStart && (r = !0);
	}
	r && n.push("---");
	let i = Ml(e, t), { commentString: a } = i.options;
	if (e.commentBefore) {
		n.length !== 1 && n.unshift("");
		let t = a(e.commentBefore);
		n.unshift(hl(t, ""));
	}
	let o = !1, s = null;
	if (e.contents) {
		if (H(e.contents)) {
			if (e.contents.spaceBefore && r && n.push(""), e.contents.commentBefore) {
				let t = a(e.contents.commentBefore);
				n.push(hl(t, ""));
			}
			i.forceBlockIndent = !!e.comment, s = e.contents.comment;
		}
		let t = s ? void 0 : () => o = !0, c = Fl(e.contents, i, () => s = null, t);
		s && (c += gl(c, "", a(s))), (c[0] === "|" || c[0] === ">") && n[n.length - 1] === "---" ? n[n.length - 1] = `--- ${c}` : n.push(c);
	} else n.push(Fl(e.contents, i));
	if (e.directives?.docEnd) {
		if (e.comment) {
			let t = a(e.comment);
			t.includes("\n") ? (n.push("..."), n.push(hl(t, ""))) : n.push(`... ${t}`);
		} else n.push("...");
	} else {
		let t = e.comment;
		t && o && (t = t.replace(/^\n+/, "")), t && ((!o || s) && n[n.length - 1] !== "" && n.push(""), n.push(hl(a(t), "")));
	}
	return n.join("\n") + "\n";
}
// node_modules/yaml/browser/dist/doc/Document.js
var $u = class e {
	constructor(e, t, n) {
		this.commentBefore = null, this.comment = null, this.errors = [], this.warnings = [], Object.defineProperty(this, R, { value: Mc });
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
		n?._directives ? (this.directives = n._directives.atDocument(), this.directives.yaml.explicit && (a = this.directives.yaml.version)) : this.directives = new Qc({ version: a }), this.setSchema(a, n), this.contents = e === void 0 ? null : this.createNode(e, r, n);
	}
	clone() {
		let t = Object.create(e.prototype, { [R]: { value: Mc } });
		return t.commentBefore = this.commentBefore, t.comment = this.comment, t.errors = this.errors.slice(), t.warnings = this.warnings.slice(), t.options = Object.assign({}, this.options), this.directives && (t.directives = this.directives.clone()), t.schema = this.schema.clone(), t.contents = H(this.contents) ? this.contents.clone(t.schema) : this.contents, this.range && (t.range = this.range.slice()), t;
	}
	add(e) {
		ed(this.contents) && this.contents.add(e);
	}
	addIn(e, t) {
		ed(this.contents) && this.contents.addIn(e, t);
	}
	createAlias(e, t) {
		if (!e.anchor) {
			let n = el(this);
			e.anchor = !t || n.has(t) ? tl(t || "a", n) : t;
		}
		return new al(e.anchor);
	}
	createNode(e, t, n) {
		let r;
		if (typeof t == "function") e = t.call({ "": e }, "", e), r = t;
		else if (Array.isArray(t)) {
			let e = t.filter((e) => typeof e == "number" || e instanceof String || e instanceof Number).map(String);
			e.length > 0 && (t = t.concat(e)), r = t;
		} else n === void 0 && t && (n = t, t = void 0);
		let { aliasDuplicateObjects: i, anchorPrefix: a, flow: o, keepUndefined: s, onTagObj: c, tag: l } = n ?? {}, { onAnchor: u, setAnchors: d, sourceObjects: f } = nl(this, a || "a"), p = {
			aliasDuplicateObjects: i ?? !0,
			keepUndefined: s ?? !1,
			onAnchor: u,
			onTagObj: c,
			replacer: r,
			schema: this.schema,
			sourceObjects: f
		}, m = ul(e, l, p);
		return o && V(m) && (m.flow = !0), d(), m;
	}
	createPair(e, t, n = {}) {
		return new G(this.createNode(e, null, n), this.createNode(t, null, n));
	}
	delete(e) {
		return ed(this.contents) ? this.contents.delete(e) : !1;
	}
	deleteIn(e) {
		return fl(e) ? this.contents != null && (this.contents = null, !0) : ed(this.contents) ? this.contents.deleteIn(e) : !1;
	}
	get(e, t) {
		return V(this.contents) ? this.contents.get(e, t) : void 0;
	}
	getIn(e, t) {
		return fl(e) ? !t && B(this.contents) ? this.contents.value : this.contents : V(this.contents) ? this.contents.getIn(e, t) : void 0;
	}
	has(e) {
		return V(this.contents) ? this.contents.has(e) : !1;
	}
	hasIn(e) {
		return fl(e) ? this.contents !== void 0 : V(this.contents) ? this.contents.hasIn(e) : !1;
	}
	set(e, t) {
		this.contents == null ? this.contents = dl(this.schema, [e], t) : ed(this.contents) && this.contents.set(e, t);
	}
	setIn(e, t) {
		fl(e) ? this.contents = t : this.contents == null ? this.contents = dl(this.schema, Array.from(e), t) : ed(this.contents) && this.contents.setIn(e, t);
	}
	setSchema(e, t = {}) {
		typeof e == "number" && (e = String(e));
		let n;
		switch (e) {
			case "1.1":
				this.directives ? this.directives.yaml.version = "1.1" : this.directives = new Qc({ version: "1.1" }), n = {
					resolveKnownTags: !1,
					schema: "yaml-1.1"
				};
				break;
			case "1.2":
			case "next":
				this.directives ? this.directives.yaml.version = e : this.directives = new Qc({ version: e }), n = {
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
		else if (n) this.schema = new Zu(Object.assign(n, t));
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
		return typeof a == "function" ? rl(a, { "": s }, "", s) : s;
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
		return Qu(this, e);
	}
};
function ed(e) {
	if (V(e)) return !0;
	throw Error("Expected a YAML collection as document contents");
}
// node_modules/yaml/browser/dist/errors.js
var td = class extends Error {
	constructor(e, t, n, r) {
		super(), this.name = e, this.code = n, this.message = r, this.pos = t;
	}
}, nd = class extends td {
	constructor(e, t, n) {
		super("YAMLParseError", e, t, n);
	}
}, rd = class extends td {
	constructor(e, t, n) {
		super("YAMLWarning", e, t, n);
	}
}, id = (e, t) => (n) => {
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
function ad(e, { flow: t, indicator: n, next: r, offset: i, onError: a, parentIndent: o, startOnNewline: s }) {
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
function od(e) {
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
				if (od(t.key) || od(t.value)) return !0;
			}
			return !1;
		default: return !0;
	}
}
// node_modules/yaml/browser/dist/compose/util-flow-indent-check.js
function sd(e, t, n) {
	if (t?.type === "flow-collection") {
		let r = t.end[0];
		r.indent === e && (r.source === "]" || r.source === "}") && od(t) && n(r, "BAD_INDENT", "Flow end indicator should be more indented than parent", !0);
	}
}
// node_modules/yaml/browser/dist/compose/util-map-includes.js
function cd(e, t, n) {
	let { uniqueKeys: r } = e.options;
	if (r === !1) return !1;
	let i = typeof r == "function" ? r : (e, t) => e === t || B(e) && B(t) && e.value === t.value;
	return t.some((e) => i(e.key, n));
}
// node_modules/yaml/browser/dist/compose/resolve-block-map.js
var ld = "All mapping items must start at the same column";
function ud({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = new ((a?.nodeClass) ?? K)(n.schema);
	n.atRoot &&= !1;
	let s = r.offset, c = null;
	for (let a of r.items) {
		let { start: l, key: u, sep: d, value: f } = a, p = ad(l, {
			indicator: "explicit-key-ind",
			next: u ?? d?.[0],
			offset: s,
			onError: i,
			parentIndent: r.indent,
			startOnNewline: !0
		}), m = !p.found;
		if (m) {
			if (u && (u.type === "block-seq" ? i(s, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key") : "indent" in u && u.indent !== r.indent && i(s, "BAD_INDENT", ld)), !p.anchor && !p.tag && !d) {
				c = p.end, p.comment && (o.comment ? o.comment += "\n" + p.comment : o.comment = p.comment);
				continue;
			}
			(p.newlineAfterProp || od(u)) && i(u ?? l[l.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
		} else p.found?.indent !== r.indent && i(s, "BAD_INDENT", ld);
		n.atKey = !0;
		let h = p.end, g = u ? e(n, u, p, i) : t(n, h, l, null, p, i);
		n.schema.compat && sd(r.indent, u, i), n.atKey = !1, cd(n, o.items, g) && i(h, "DUPLICATE_KEY", "Map keys must be unique");
		let _ = ad(d ?? [], {
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
			n.schema.compat && sd(r.indent, f, i), s = c.range[2];
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
function dd({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = new ((a?.nodeClass) ?? $l)(n.schema);
	n.atRoot &&= !1, n.atKey &&= !1;
	let s = r.offset, c = null;
	for (let { start: a, value: l } of r.items) {
		let u = ad(a, {
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
		n.schema.compat && sd(r.indent, l, i), s = d.range[2], o.items.push(d);
	}
	return o.range = [
		r.offset,
		s,
		c ?? s
	], o;
}
// node_modules/yaml/browser/dist/compose/resolve-end.js
function fd(e, t, n, r) {
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
var pd = "Block collections are not allowed within flow collections", md = (e) => e && (e.type === "block-map" || e.type === "block-seq");
function hd({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = r.start.source === "{", s = o ? "flow map" : "flow sequence", c = new ((a?.nodeClass) ?? (o ? K : $l))(n.schema);
	c.flow = !0;
	let l = n.atRoot;
	l && (n.atRoot = !1), n.atKey &&= !1;
	let u = r.offset + r.start.source.length;
	for (let a = 0; a < r.items.length; ++a) {
		let l = r.items[a], { start: d, key: f, sep: p, value: m } = l, h = ad(d, {
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
			!o && n.options.strict && od(f) && i(f, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
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
			c.items.push(r), u = r.range[2], md(m) && i(r.range, "BLOCK_IN_FLOW", pd);
		} else {
			n.atKey = !0;
			let a = h.end, g = f ? e(n, f, h, i) : t(n, a, d, null, h, i);
			md(f) && i(g.range, "BLOCK_IN_FLOW", pd), n.atKey = !1;
			let _ = ad(p ?? [], {
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
			v ? md(m) && i(v.range, "BLOCK_IN_FLOW", pd) : _.comment && (g.comment ? g.comment += "\n" + _.comment : g.comment = _.comment);
			let y = new G(g, v);
			if (n.options.keepSourceTokens && (y.srcToken = l), o) {
				let e = c;
				cd(n, e.items, g) && i(a, "DUPLICATE_KEY", "Map keys must be unique"), e.items.push(y);
			} else {
				let e = new K(n.schema);
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
		let e = fd(p, m, n.options.strict, i);
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
function gd(e, t, n, r, i, a) {
	let o = n.type === "block-map" ? ud(e, t, n, r, a) : n.type === "block-seq" ? dd(e, t, n, r, a) : hd(e, t, n, r, a), s = o.constructor;
	return i === "!" || i === s.tagName ? (o.tag = s.tagName, o) : (i && (o.tag = i), o);
}
function _d(e, t, n, r, i) {
	let a = r.tag, o = a ? t.directives.tagName(a.source, (e) => i(a, "TAG_RESOLVE_FAILED", e)) : null;
	if (n.type === "block-seq") {
		let { anchor: e, newlineAfterProp: t } = r, n = e && a ? e.offset > a.offset ? e : a : e ?? a;
		n && (!t || t.offset < n.offset) && i(n, "MISSING_CHAR", "Missing newline after block sequence props");
	}
	let s = n.type === "block-map" ? "map" : n.type === "block-seq" ? "seq" : n.start.source === "{" ? "map" : "seq";
	if (!a || !o || o === "!" || o === K.tagName && s === "map" || o === $l.tagName && s === "seq") return gd(e, t, n, i, o);
	let c = t.schema.tags.find((e) => e.tag === o && e.collection === s);
	if (!c) {
		let r = t.schema.knownTags[o];
		if (r?.collection === s) t.schema.tags.push(Object.assign({}, r, { default: !1 })), c = r;
		else return r ? i(a, "BAD_COLLECTION_TYPE", `${r.tag} used for ${s} collection, but expects ${r.collection ?? "scalar"}`, !0) : i(a, "TAG_RESOLVE_FAILED", `Unresolved tag: ${o}`, !0), gd(e, t, n, i, o);
	}
	let l = gd(e, t, n, i, o, c), u = c.resolve?.(l, (e) => i(a, "TAG_RESOLVE_FAILED", e), t.options) ?? l, d = H(u) ? u : new W(u);
	return d.range = l.range, d.tag = o, c?.format && (d.format = c.format), d;
}
// node_modules/yaml/browser/dist/compose/resolve-block-scalar.js
function vd(e, t, n) {
	let r = t.offset, i = yd(t, e.options.strict, n);
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
	let a = i.mode === ">" ? W.BLOCK_FOLDED : W.BLOCK_LITERAL, o = t.source ? bd(t.source) : [], s = o.length;
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
function yd({ offset: e, props: t }, n, r) {
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
function bd(e) {
	let t = e.split(/\n( *)/), n = t[0], r = n.match(/^( *)/), i = [r?.[1] ? [r[1], n.slice(r[1].length)] : ["", n]];
	for (let e = 1; e < t.length; e += 2) i.push([t[e], t[e + 1]]);
	return i;
}
// node_modules/yaml/browser/dist/compose/resolve-flow-scalar.js
function xd(e, t, n) {
	let { offset: r, type: i, source: a, end: o } = e, s, c, l = (e, t, i) => n(r + e, t, i);
	switch (i) {
		case "scalar":
			s = W.PLAIN, c = Sd(a, l);
			break;
		case "single-quoted-scalar":
			s = W.QUOTE_SINGLE, c = Cd(a, l);
			break;
		case "double-quoted-scalar":
			s = W.QUOTE_DOUBLE, c = Td(a, l);
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
	let u = r + a.length, d = fd(o, u, t, n);
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
function Sd(e, t) {
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
	return n && t(0, "BAD_SCALAR_START", `Plain value cannot start with ${n}`), wd(e);
}
function Cd(e, t) {
	return (e[e.length - 1] !== "'" || e.length === 1) && t(e.length, "MISSING_CHAR", "Missing closing 'quote"), wd(e.slice(1, -1)).replace(/''/g, "'");
}
function wd(e) {
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
function Td(e, t) {
	let n = "";
	for (let r = 1; r < e.length - 1; ++r) {
		let i = e[r];
		if (i !== "\r" || e[r + 1] !== "\n") {
			if (i === "\n") {
				let { fold: t, offset: i } = Ed(e, r);
				n += t, r = i;
			} else if (i === "\\") {
				let i = e[++r], a = Dd[i];
				if (a) n += a;
				else if (i === "\n") for (i = e[r + 1]; i === " " || i === "	";) i = e[++r + 1];
				else if (i === "\r" && e[r + 1] === "\n") for (i = e[++r + 1]; i === " " || i === "	";) i = e[++r + 1];
				else if (i === "x" || i === "u" || i === "U") {
					let a = i === "x" ? 2 : i === "u" ? 4 : 8;
					n += Od(e, r + 1, a, t), r += a;
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
function Ed(e, t) {
	let n = "", r = e[t + 1];
	for (; (r === " " || r === "	" || r === "\n" || r === "\r") && (r !== "\r" || e[t + 2] === "\n");) r === "\n" && (n += "\n"), t += 1, r = e[t + 1];
	return n ||= " ", {
		fold: n,
		offset: t
	};
}
var Dd = {
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
function Od(e, t, n, r) {
	let i = e.substr(t, n), a = i.length === n && /^[0-9a-fA-F]+$/.test(i) ? parseInt(i, 16) : NaN;
	try {
		return String.fromCodePoint(a);
	} catch {
		let i = e.substr(t - 2, n + 2);
		return r(t - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${i}`), i;
	}
}
// node_modules/yaml/browser/dist/compose/compose-scalar.js
function kd(e, t, n, r) {
	let { value: i, type: a, comment: o, range: s } = t.type === "block-scalar" ? vd(e, t, r) : xd(t, e.options.strict, r), c = n ? e.directives.tagName(n.source, (e) => r(n, "TAG_RESOLVE_FAILED", e)) : null, l;
	l = e.options.stringKeys && e.atKey ? e.schema[Fc] : c ? Ad(e.schema, i, c, n, r) : t.type === "scalar" ? jd(e, i, t, r) : e.schema[Fc];
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
function Ad(e, t, n, r, i) {
	if (n === "!") return e[Fc];
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
	})), o) : (i(r, "TAG_RESOLVE_FAILED", `Unresolved tag: ${n}`, n !== "tag:yaml.org,2002:str"), e[Fc]);
}
function jd({ atKey: e, directives: t, schema: n }, r, i, a) {
	let o = n.tags.find((t) => (t.default === !0 || e && t.default === "key") && t.test?.test(r)) || n[Fc];
	if (n.compat) {
		let e = n.compat.find((e) => e.default && e.test?.test(r)) ?? n[Fc];
		o.tag !== e.tag && a(i, "TAG_RESOLVE_FAILED", `Value may be parsed as either ${t.tagString(o.tag)} or ${t.tagString(e.tag)}`, !0);
	}
	return o;
}
// node_modules/yaml/browser/dist/compose/util-empty-scalar-position.js
function Md(e, t, n) {
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
var Nd = {
	composeNode: Pd,
	composeEmptyNode: Fd
};
function Pd(e, t, n, r) {
	let i = e.atKey, { spaceBefore: a, comment: o, anchor: s, tag: c } = n, l, u = !0;
	switch (t.type) {
		case "alias":
			l = Id(e, t, r), (s || c) && r(t, "ALIAS_PROPS", "An alias node must not specify any properties");
			break;
		case "scalar":
		case "single-quoted-scalar":
		case "double-quoted-scalar":
		case "block-scalar":
			l = kd(e, t, c, r), s && (l.anchor = s.source.substring(1));
			break;
		case "block-map":
		case "block-seq":
		case "flow-collection":
			try {
				l = _d(Nd, e, t, n, r), s && (l.anchor = s.source.substring(1));
			} catch (e) {
				r(t, "RESOURCE_EXHAUSTION", e instanceof Error ? e.message : String(e));
			}
			break;
		default: r(t, "UNEXPECTED_TOKEN", t.type === "error" ? t.message : `Unsupported token (type: ${t.type})`), u = !1;
	}
	return l ??= Fd(e, t.offset, void 0, null, n, r), s && l.anchor === "" && r(s, "BAD_ALIAS", "Anchor cannot be an empty string"), i && e.options.stringKeys && (!B(l) || typeof l.value != "string" || l.tag && l.tag !== "tag:yaml.org,2002:str") && r(c ?? t, "NON_STRING_KEY", "With stringKeys, all keys must be strings"), a && (l.spaceBefore = !0), o && (t.type === "scalar" && t.source === "" ? l.comment = o : l.commentBefore = o), e.options.keepSourceTokens && u && (l.srcToken = t), l;
}
function Fd(e, t, n, r, { spaceBefore: i, comment: a, anchor: o, tag: s, end: c }, l) {
	let u = kd(e, {
		type: "scalar",
		offset: Md(t, n, r),
		indent: -1,
		source: ""
	}, s, l);
	return o && (u.anchor = o.source.substring(1), u.anchor === "" && l(o, "BAD_ALIAS", "Anchor cannot be an empty string")), i && (u.spaceBefore = !0), a && (u.comment = a, u.range[2] = c), u;
}
function Id({ options: e }, { offset: t, source: n, end: r }, i) {
	let a = new al(n.substring(1));
	a.source === "" && i(t, "BAD_ALIAS", "Alias cannot be an empty string"), a.source.endsWith(":") && i(t + n.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", !0);
	let o = t + n.length, s = fd(r, o, e.strict, i);
	return a.range = [
		t,
		o,
		s.offset
	], s.comment && (a.comment = s.comment), a;
}
// node_modules/yaml/browser/dist/compose/compose-doc.js
function Ld(e, t, { offset: n, start: r, value: i, end: a }, o) {
	let s = new $u(void 0, Object.assign({ _directives: t }, e)), c = {
		atKey: !1,
		atRoot: !0,
		directives: s.directives,
		options: s.options,
		schema: s.schema
	}, l = ad(r, {
		indicator: "doc-start",
		next: i ?? a?.[0],
		offset: n,
		onError: o,
		parentIndent: 0,
		startOnNewline: !0
	});
	l.found && (s.directives.docStart = !0, i && (i.type === "block-map" || i.type === "block-seq") && !l.hasNewline && o(l.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker")), s.contents = i ? Pd(c, i, l, o) : Fd(c, l.end, r, null, l, o);
	let u = s.contents.range[2], d = fd(a, u, !1, o);
	return d.comment && (s.comment = d.comment), s.range = [
		n,
		u,
		d.offset
	], s;
}
// node_modules/yaml/browser/dist/compose/composer.js
function Rd(e) {
	if (typeof e == "number") return [e, e + 1];
	if (Array.isArray(e)) return e.length === 2 ? e : [e[0], e[1]];
	let { offset: t, source: n } = e;
	return [t, t + (typeof n == "string" ? n.length : 1)];
}
function zd(e) {
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
var Bd = class {
	constructor(e = {}) {
		this.doc = null, this.atDirectives = !1, this.prelude = [], this.errors = [], this.warnings = [], this.onError = (e, t, n, r) => {
			let i = Rd(e);
			r ? this.warnings.push(new rd(i, t, n)) : this.errors.push(new nd(i, t, n));
		}, this.directives = new Qc({ version: e.version || "1.2" }), this.options = e;
	}
	decorate(e, t) {
		let { comment: n, afterEmptyLine: r } = zd(this.prelude);
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
			comment: zd(this.prelude).comment,
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
					let i = Rd(e);
					i[0] += t, this.onError(i, "BAD_DIRECTIVE", n, r);
				}), this.prelude.push(e.source), this.atDirectives = !0;
				break;
			case "document": {
				let t = Ld(this.options, this.directives, e, this.onError);
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
				let t = e.source ? `${e.message}: ${JSON.stringify(e.source)}` : e.message, n = new nd(Rd(e), "UNEXPECTED_TOKEN", t);
				this.atDirectives || !this.doc ? this.errors.push(n) : this.doc.errors.push(n);
				break;
			}
			case "doc-end": {
				if (!this.doc) {
					this.errors.push(new nd(Rd(e), "UNEXPECTED_TOKEN", "Unexpected doc-end without preceding document"));
					break;
				}
				this.doc.directives.docEnd = !0;
				let t = fd(e.end, e.offset + e.source.length, this.doc.options.strict, this.onError);
				if (this.decorate(this.doc, !0), t.comment) {
					let e = this.doc.comment;
					this.doc.comment = e ? `${e}\n${t.comment}` : t.comment;
				}
				this.doc.range[2] = t.offset;
				break;
			}
			default: this.errors.push(new nd(Rd(e), "UNEXPECTED_TOKEN", `Unsupported token ${e.type}`));
		}
	}
	*end(e = !1, t = -1) {
		if (this.doc) this.decorate(this.doc, !0), yield this.doc, this.doc = null;
		else if (e) {
			let e = new $u(void 0, Object.assign({ _directives: this.directives }, this.options));
			this.atDirectives && this.onError(t, "MISSING_CHAR", "Missing directives-end indicator line"), e.range = [
				0,
				t,
				t
			], this.decorate(e, !1), yield e;
		}
	}
}, Vd = Symbol("break visit"), Hd = Symbol("skip children"), Ud = Symbol("remove item");
function Wd(e, t) {
	"type" in e && e.type === "document" && (e = {
		start: e.start,
		value: e.value
	}), Gd(Object.freeze([]), e, t);
}
Wd.BREAK = Vd, Wd.SKIP = Hd, Wd.REMOVE = Ud, Wd.itemAtPath = (e, t) => {
	let n = e;
	for (let [e, r] of t) {
		let t = n?.[e];
		if (t && "items" in t) n = t.items[r];
		else return;
	}
	return n;
}, Wd.parentCollection = (e, t) => {
	let n = Wd.itemAtPath(e, t.slice(0, -1)), r = t[t.length - 1][0], i = n?.[r];
	if (i && "items" in i) return i;
	throw Error("Parent collection not found");
};
function Gd(e, t, n) {
	let r = n(t, e);
	if (typeof r == "symbol") return r;
	for (let i of ["key", "value"]) {
		let a = t[i];
		if (a && "items" in a) {
			for (let t = 0; t < a.items.length; ++t) {
				let r = Gd(Object.freeze(e.concat([[i, t]])), a.items[t], n);
				if (typeof r == "number") t = r - 1;
				else if (r === Vd) return Vd;
				else r === Ud && (a.items.splice(t, 1), --t);
			}
			typeof r == "function" && i === "key" && (r = r(t, e));
		}
	}
	return typeof r == "function" ? r(t, e) : r;
}
function Kd(e) {
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
function J(e) {
	switch (e) {
		case void 0:
		case " ":
		case "\n":
		case "\r":
		case "	": return !0;
		default: return !1;
	}
}
var qd = /* @__PURE__ */ new Set("0123456789ABCDEFabcdef"), Jd = /* @__PURE__ */ new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()"), Yd = /* @__PURE__ */ new Set(",[]{}"), Xd = /* @__PURE__ */ new Set(" ,[]{}\n\r	"), Zd = (e) => !e || Xd.has(e), Qd = class {
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
			if ((t === "---" || t === "...") && J(this.buffer[e + 3])) return -1;
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
			if ((e === "---" || e === "...") && J(this.charAt(3))) return yield* this.pushCount(3), this.indentValue = 0, this.indentNext = 0, e === "---" ? "doc" : "stream";
		}
		return this.indentValue = yield* this.pushSpaces(!1), this.indentNext > this.indentValue && !J(this.charAt(1)) && (this.indentNext = this.indentValue), yield* this.parseBlockStart();
	}
	*parseBlockStart() {
		let [e, t] = this.peek(2);
		if (!t && !this.atEnd) return this.setNext("block-start");
		if ((e === "-" || e === "?" || e === ":") && J(t)) {
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
			case "*": return yield* this.pushUntil(Zd), "doc";
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
		if ((n !== -1 && n < this.indentNext && r[0] !== "#" || n === 0 && (r.startsWith("---") || r.startsWith("...")) && J(r[3])) && (n !== this.indentNext - 1 || this.flowLevel !== 1 || r[0] !== "]" && r[0] !== "}")) return this.flowLevel = 0, yield "", yield* this.parseLineStart();
		let i = 0;
		for (; r[i] === ",";) i += yield* this.pushCount(1), i += yield* this.pushSpaces(!0), this.flowKey = !1;
		switch (i += yield* this.pushIndicators(), r[i]) {
			case void 0: return "flow";
			case "#": return yield* this.pushCount(r.length - i), "flow";
			case "{":
			case "[": return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel += 1, "flow";
			case "}":
			case "]": return yield* this.pushCount(1), this.flowKey = !0, --this.flowLevel, this.flowLevel ? "flow" : "doc";
			case "*": return yield* this.pushUntil(Zd), "flow";
			case "\"":
			case "'": return this.flowKey = !0, yield* this.parseQuotedScalar();
			case ":": {
				let e = this.charAt(1);
				if (this.flowKey || J(e) || e === ",") return this.flowKey = !1, yield* this.pushCount(1), yield* this.pushSpaces(!0), "flow";
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
		return yield* this.pushUntil((e) => J(e) || e === "#");
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
			if (J(r) || e && Yd.has(r)) break;
			t = n;
		} else if (J(r)) {
			let i = this.buffer[n + 1];
			if (r === "\r" && (i === "\n" ? (n += 1, r = "\n", i = this.buffer[n + 1]) : t = n), i === "#" || e && Yd.has(i)) break;
			if (r === "\n") {
				let e = this.continueScalar(n + 1);
				if (e === -1) break;
				n = Math.max(n, e - 2);
			}
		} else {
			if (e && Yd.has(r)) break;
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
					e += yield* this.pushUntil(Zd), e += yield* this.pushSpaces(!0);
					continue loop;
				case "-":
				case "?":
				case ":": {
					let t = this.flowLevel > 0, n = this.charAt(1);
					if (J(n) || t && Yd.has(n)) {
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
			for (; !J(t) && t !== ">";) t = this.buffer[++e];
			return yield* this.pushToIndex(t === ">" ? e + 1 : e, !1);
		}
		{
			let e = this.pos + 1, t = this.buffer[e];
			for (; t;) if (Jd.has(t)) t = this.buffer[++e];
			else if (t === "%" && qd.has(this.buffer[e + 1]) && qd.has(this.buffer[e + 2])) t = this.buffer[e += 3];
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
}, $d = class {
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
function ef(e, t) {
	for (let n = 0; n < e.length; ++n) if (e[n].type === t) return !0;
	return !1;
}
function tf(e) {
	for (let t = 0; t < e.length; ++t) switch (e[t].type) {
		case "space":
		case "comment":
		case "newline": break;
		default: return t;
	}
	return -1;
}
function nf(e) {
	switch (e?.type) {
		case "alias":
		case "scalar":
		case "single-quoted-scalar":
		case "double-quoted-scalar":
		case "flow-collection": return !0;
		default: return !1;
	}
}
function rf(e) {
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
function af(e) {
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
function of(e, t) {
	if (t.length < 1e5) Array.prototype.push.apply(e, t);
	else for (let n = 0; n < t.length; ++n) e.push(t[n]);
}
function sf(e) {
	if (e.start.type === "flow-seq-start") for (let t of e.items) t.sep && !t.value && !ef(t.start, "explicit-key-ind") && !ef(t.sep, "map-value-ind") && (t.key && (t.value = t.key), delete t.key, nf(t.value) ? t.value.end ? of(t.value.end, t.sep) : t.value.end = t.sep : of(t.start, t.sep), delete t.sep);
}
var cf = class {
	constructor(e) {
		this.atNewLine = !0, this.atScalar = !1, this.indent = 0, this.offset = 0, this.onKeyLine = !1, this.stack = [], this.source = "", this.type = "", this.lexer = new Qd(), this.onNewLine = e;
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
		let t = Kd(e);
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
			switch (t.type === "block-scalar" ? t.indent = "indent" in e ? e.indent : 0 : t.type === "flow-collection" && e.type === "document" && (t.indent = 0), t.type === "flow-collection" && sf(t), e.type) {
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
				n && !n.sep && !n.value && n.start.length > 0 && tf(n.start) === -1 && (t.indent === 0 || n.start.every((e) => e.type !== "comment" || e.indent < t.indent)) && (e.type === "document" ? e.end = n.start : e.items.push({ start: n.start }), t.items.splice(-1, 1));
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
				tf(e.start) === -1 ? e.start.push(this.sourceToken) : (yield* this.pop(), yield* this.step());
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
			let t = af(rf(this.peek(2))), n;
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
							of(n, t.start), n.push(this.sourceToken), e.items.pop();
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
							if (ef(t.start, "newline")) Object.assign(t, {
								key: null,
								sep: [this.sourceToken]
							});
							else {
								let e = af(t.start);
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
						else if (ef(t.sep, "map-value-ind")) this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: i,
								key: null,
								sep: [this.sourceToken]
							}]
						});
						else if (nf(t.key) && !ef(t.sep, "newline")) {
							let e = af(t.start), n = t.key, r = t.sep;
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
					}) : ef(t.sep, "map-value-ind") ? this.stack.push({
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
							if (!t.explicitKey && t.sep && !ef(t.sep, "newline")) {
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
							of(n, t.start), n.push(this.sourceToken), e.items.pop();
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
				t.value || ef(t.start, "seq-item-ind") ? e.items.push({ start: [this.sourceToken] }) : t.start.push(this.sourceToken);
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
				let n = af(rf(t));
				sf(e);
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
				let t = af(rf(e));
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
				let t = af(rf(e));
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
function lf(e) {
	let t = e.prettyErrors !== !1;
	return {
		lineCounter: e.lineCounter || t && new $d() || null,
		prettyErrors: t
	};
}
function uf(e, t = {}) {
	let { lineCounter: n, prettyErrors: r } = lf(t), i = new cf(n?.addNewLine), a = new Bd(t), o = null;
	for (let t of a.compose(i.parse(e), !0, e.length)) if (!o) o = t;
	else if (o.options.logLevel !== "silent") {
		o.errors.push(new nd(t.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
		break;
	}
	return r && n && (o.errors.forEach(id(e, n)), o.warnings.forEach(id(e, n))), o;
}
function df(e, t, n) {
	let r;
	typeof t == "function" ? r = t : n === void 0 && t && typeof t == "object" && (n = t);
	let i = uf(e, n);
	if (!i) return null;
	if (i.warnings.forEach((e) => Ll(i.options.logLevel, e)), i.errors.length > 0) {
		if (i.options.logLevel !== "silent") throw i.errors[0];
		i.errors = [];
	}
	return i.toJS(Object.assign({ reviver: r }, n));
}
// src/server/catalog/frontmatter.ts
var ff = {
	UNTERMINATED: "FRONTMATTER_UNTERMINATED",
	INVALID_YAML: "FRONTMATTER_INVALID_YAML",
	NOT_A_MAPPING: "FRONTMATTER_NOT_A_MAPPING"
}, pf = class extends Error {
	code;
	constructor(e, t, n = {}) {
		super(t, n.cause === void 0 ? void 0 : { cause: n.cause }), this.name = new.target.name, this.code = e;
	}
}, mf = /^---[ \t]*(\r?\n|$)/, hf = /^---[ \t]*$/m;
function gf(e) {
	let t = vf(e), n = mf.exec(t);
	if (!n) return {
		present: !1,
		data: {},
		body: t
	};
	let r = t.slice(n[0].length), i = hf.exec(r);
	if (!i) throw new pf(ff.UNTERMINATED, "The SKILL.md frontmatter is missing its closing \"---\" delimiter.");
	let a = r.slice(0, i.index), o = r.slice(i.index + i[0].length).replace(/^\r?\n/, "");
	if (a.trim() === "") return {
		present: !0,
		data: {},
		body: o
	};
	let s;
	try {
		s = df(a);
	} catch (e) {
		throw new pf(ff.INVALID_YAML, "The SKILL.md frontmatter is not valid YAML.", { cause: e });
	}
	if (s == null) return {
		present: !0,
		data: {},
		body: o
	};
	if (!yf(s)) throw new pf(ff.NOT_A_MAPPING, "The SKILL.md frontmatter must be a YAML mapping.");
	return {
		present: !0,
		data: s,
		body: o
	};
}
function _f(e, t) {
	if (!Object.hasOwn(e, t)) return;
	let n = e[t];
	if (typeof n != "string") return;
	let r = n.trim();
	return r === "" ? void 0 : r;
}
function vf(e) {
	return e.charCodeAt(0) === 65279 ? e.slice(1) : e;
}
function yf(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
// src/shared/chain.ts
function bf(e) {
	return e.label?.trim() || (e.kind === "instruction" ? "Instruction" : e.skillName);
}
var xf = rc(["opencode", "copilot"]), Y = P().trim().min(1), Sf = L({
	opencode: Y.optional(),
	copilot: Y.optional()
}), Cf = L({
	id: Y,
	canonicalPath: Y,
	displayName: Y,
	lastOpenedAt: Ac({ offset: !0 }),
	managedWorkspace: ac(!0).optional()
}), wf = L({
	id: ys(),
	projectId: Y,
	sourceProjectId: Y.optional(),
	sourceChainId: Y.optional(),
	sourceDraftId: Y.optional(),
	chainId: Y,
	createdAt: Ac({ offset: !0 })
}).superRefine((e, t) => {
	(e.sourceProjectId !== void 0 && e.sourceChainId !== void 0) == (e.sourceDraftId !== void 0) && t.addIssue({
		code: "custom",
		message: "A test workspace must have exactly one valid source chain or draft."
	}), e.sourceProjectId === void 0 != (e.sourceChainId === void 0) && t.addIssue({
		code: "custom",
		message: "A project source requires both project and chain ids."
	});
}), Tf = P().trim().min(1).max(2048).refine((e) => {
	if (/^git@[^/:\\\s]+:[^\\\s?#]+(?:\.git)?$/i.test(e)) return !0;
	let t;
	try {
		t = new URL(e);
	} catch {
		return !1;
	}
	return (t.protocol === "https:" || t.protocol === "ssh:") && (t.username === "" || t.protocol === "ssh:" && t.username === "git") && t.password === "" && t.search === "" && t.hash === "" && t.hostname !== "";
}, "Use an HTTPS or SSH Git remote without embedded credentials or query parameters."), Ef = P().trim().min(1).max(255).refine((e) => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(e) && !e.includes("..") && !e.includes("//") && !e.includes("@{") && !e.endsWith("/") && !e.endsWith(".") && !e.split("/").some((e) => e.endsWith(".lock")), "Use a branch, tag, or full commit hash."), Df = L({
	id: P().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	repository: Tf,
	ref: Ef.optional()
}), Of = tc(P(), Us());
L({
	version: ac(1),
	harnessCommands: Sf.default({}),
	extraSkillDirectories: I(Y).default([]),
	remoteSkillSources: I(Df).default([]),
	sharedBundleDirectory: Y.optional(),
	recentProjects: I(Cf).default([]),
	testWorkspaces: I(wf).default([]),
	uiPreferences: Of.default({})
}), L({
	harnessCommands: Sf.optional(),
	extraSkillDirectories: I(Y).optional(),
	remoteSkillSources: I(Df).optional(),
	sharedBundleDirectory: Y.nullable().optional(),
	recentProjects: I(Cf).optional(),
	testWorkspaces: I(wf).optional(),
	uiPreferences: Of.optional()
});
var kf = rc([
	"shared",
	"fresh",
	"fork"
]), Af = /^[A-Za-z][A-Za-z0-9_]*$/, jf = P().trim().min(1), Mf = Ac({ offset: !0 }), Nf = L({
	harness: xf,
	name: jf,
	sourceId: P().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	revision: P().regex(/^[a-f0-9]{40,64}$/),
	repositoryPath: jf.max(4096),
	agentPath: jf.max(4096),
	fingerprint: P().regex(/^[a-f0-9]{64}$/)
}), Pf = {
	id: jf,
	instruction: jf,
	label: jf.optional()
}, Ff = Zs("kind", [L({
	...Pf,
	kind: ac("skill").optional(),
	skillName: jf
}), L({
	...Pf,
	kind: ac("instruction"),
	skillName: Gs().optional()
})]), If = L({
	name: P().regex(Af),
	label: jf.optional(),
	required: Vs().default(!1),
	defaultValue: P().optional()
}), Lf = {
	id: jf,
	name: jf,
	harness: xf,
	sessionMode: kf,
	steps: I(Ff).min(1),
	inputs: I(If).default([]),
	automaticPermissionOptIn: Vs().default(!1),
	createdAt: Mf,
	updatedAt: Mf
};
L({
	version: ac(1),
	...Lf
});
var X = L({
	version: ac(2),
	...Lf,
	agent: Nf.optional()
}), Rf = {
	DUPLICATE_STEP_ID: "chain_duplicate_step_id",
	DUPLICATE_INPUT_NAME: "chain_duplicate_input_name",
	PLACEHOLDER_INVALID: "chain_placeholder_invalid",
	PLACEHOLDER_UNKNOWN: "chain_placeholder_unknown",
	AGENT_HARNESS_MISMATCH: "chain_agent_harness_mismatch"
}, zf = { INPUT_UNUSED: "chain_input_unused" }, Bf = class extends Error {
	code;
	details;
	constructor(e, t, n = {}, r = {}) {
		super(t, r.cause === void 0 ? void 0 : { cause: r.cause }), this.name = new.target.name, this.code = e, this.details = n;
	}
}, Vf = class extends Bf {
	issues;
	constructor(e) {
		super("CHAIN_INVALID", "The chain is not valid.", { issues: e }), this.issues = e;
	}
};
function Hf(e) {
	let t = X.safeParse(e);
	if (!t.success) throw new Vf(Yf(t.error.issues));
	let n = t.data, r = [];
	if (n.agent !== void 0 && n.agent.harness !== n.harness && r.push({
		path: "agent.harness",
		code: Rf.AGENT_HARNESS_MISMATCH,
		message: `The selected ${n.agent.harness} agent is incompatible with the ${n.harness} chain harness.`
	}), Gf(n, r), Kf(n, r), qf(n, r), r.length > 0) throw new Vf(r);
	return {
		chain: n,
		warnings: Wf(n)
	};
}
function Uf(e) {
	return Hf(e).chain;
}
function Wf(e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e.steps) for (let e of Jf(n.instruction)) t.add(e.name);
	let n = [];
	return e.inputs.forEach((e, r) => {
		t.has(e.name) || n.push({
			path: `inputs.${String(r)}.name`,
			code: zf.INPUT_UNUSED,
			message: `Input "${e.name}" is declared but never used in an instruction.`,
			inputName: e.name
		});
	}), n;
}
function Gf(e, t) {
	let n = /* @__PURE__ */ new Map();
	e.steps.forEach((e, r) => {
		let i = n.get(e.id);
		i === void 0 ? n.set(e.id, r) : t.push({
			path: `steps.${String(r)}.id`,
			code: Rf.DUPLICATE_STEP_ID,
			message: `Step id "${e.id}" is already used by step ${String(i + 1)}.`,
			stepId: e.id,
			stepIndex: r
		});
	});
}
function Kf(e, t) {
	let n = /* @__PURE__ */ new Map();
	e.inputs.forEach((e, r) => {
		let i = n.get(e.name);
		i === void 0 ? n.set(e.name, r) : t.push({
			path: `inputs.${String(r)}.name`,
			code: Rf.DUPLICATE_INPUT_NAME,
			message: `Input name "${e.name}" is already declared by input ${String(i + 1)}.`,
			inputName: e.name
		});
	});
}
function qf(e, t) {
	let n = new Set(e.inputs.map((e) => e.name));
	e.steps.forEach((e, r) => {
		let i = /* @__PURE__ */ new Set();
		for (let a of Jf(e.instruction)) {
			if (i.has(a.name)) continue;
			let o = bf(e);
			a.name === "" || !Af.test(a.name) ? (i.add(a.name), t.push({
				path: `steps.${String(r)}.instruction`,
				code: Rf.PLACEHOLDER_INVALID,
				message: `Step "${o}" contains an invalid placeholder "${a.raw}".`,
				stepId: e.id,
				stepIndex: r,
				inputName: a.name
			})) : n.has(a.name) || (i.add(a.name), t.push({
				path: `steps.${String(r)}.instruction`,
				code: Rf.PLACEHOLDER_UNKNOWN,
				message: `Step "${o}" references undeclared input "${a.name}".`,
				stepId: e.id,
				stepIndex: r,
				inputName: a.name
			}));
		}
	});
}
function Jf(e) {
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
function Yf(e) {
	return e.map((e) => ({
		path: e.path.map((e) => String(e)).join("."),
		code: e.code,
		message: e.message
	}));
}
// src/portable/bundle.ts
var Xf = 20971520, Zf = 2e3, Qf = class extends Error {
	code;
	constructor(e, t) {
		super(t), this.code = e, this.name = "BundleError";
	}
}, $f = /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i, ep = L({
	path: P().min(1).max(512),
	content: P().max(Math.ceil(Xf / 3) * 4),
	executable: Vs()
}), tp = L({
	format: ac("skill-loom-chain"),
	version: ac(1),
	chain: L({
		name: X.shape.name,
		harness: X.shape.harness,
		sessionMode: X.shape.sessionMode,
		steps: X.shape.steps,
		inputs: X.shape.inputs
	}),
	skills: I(L({
		name: P().trim().min(1).max(128),
		directory: P().min(1).max(128).regex(/^[^/\\]+$/),
		files: I(ep).min(1).max(Zf)
	})).max(100)
}), np = L({
	name: P().trim().min(1).max(128),
	harness: X.shape.harness,
	agentPath: P().min(1).max(512),
	fingerprint: P().regex(/^[a-f0-9]{64}$/),
	content: P().max(Math.ceil(Xf / 3) * 4)
}), rp = L({
	format: ac("skill-loom-chain"),
	version: ac(2),
	chain: L({
		name: X.shape.name,
		harness: X.shape.harness,
		sessionMode: X.shape.sessionMode,
		steps: X.shape.steps,
		inputs: X.shape.inputs,
		agent: Nf.optional()
	}),
	skills: I(L({
		name: P().trim().min(1).max(128),
		directory: P().min(1).max(128).regex(/^[^/\\]+$/),
		files: I(ep).min(1).max(Zf)
	})).max(100),
	agents: I(np).max(1)
});
function Z(e) {
	throw new Qf("BUNDLE_INVALID", e);
}
function ip(e) {
	let t = e.split("/");
	(t.length > 32 || t.some((e) => e === "." || e === ".." || !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(e) || /[. ]$/.test(e) || $f.test(e) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(e))) && Z("The bundle contains an unsafe or excluded package path.");
}
function ap(e) {
	(e.length % 4 != 0 || /[^A-Za-z0-9+/=]/.test(e)) && Z("Package file contents must be canonical base64.");
	let t = Buffer.from(e, "base64");
	return t.toString("base64") !== e && Z("Package file contents are not canonical base64."), t;
}
function op(e) {
	return [...new Set(e.steps.flatMap((e) => "skillName" in e && typeof e.skillName == "string" ? [e.skillName] : []))];
}
function sp(e) {
	let t = e.version === 2 ? e.chain.agent : void 0;
	return Uf({
		...e.chain,
		...t === void 0 ? {} : { agent: t },
		version: 2,
		id: "portable-bundle",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		automaticPermissionOptIn: !1
	});
}
function cp(e) {
	let t = lp(e) ? e.version : void 0, n = t === 1 ? tp.safeParse(e) : t === 2 ? rp.safeParse(e) : null;
	n === null && Z("The file is not a supported Skill Loom chain bundle."), n.success || Z("The file is not a supported Skill Loom chain bundle.");
	let r = n.data, i = sp(r), a = new Set(op(i)), s = /* @__PURE__ */ new Set(), c = /* @__PURE__ */ new Set(), l = 0, u = 0;
	for (let e of r.skills) {
		ip(e.directory);
		let t = e.directory.toLowerCase();
		(s.has(e.name) || c.has(t) || !a.has(e.name)) && Z("The bundle contains duplicate or unreferenced skill packages."), s.add(e.name), c.add(t);
		let n = /* @__PURE__ */ new Set();
		for (let t of e.files) {
			ip(t.path);
			let e = t.path.toLowerCase();
			if (n.has(e) && Z("The bundle contains duplicate package file paths."), n.add(e), l += ap(t.content).length, u += 1, l > 20971520 || u > 2e3) throw new Qf("BUNDLE_TOO_LARGE", "Bundles are limited to 20 MiB and 2,000 files.");
		}
		for (let e of n) {
			let t = e.split("/");
			for (; t.length > 1;) t.pop(), n.has(t.join("/")) && Z("A package file conflicts with a directory.");
		}
		let r = e.files.find((e) => e.path === "SKILL.md");
		r || Z("Each skill package must include SKILL.md.");
		let i;
		try {
			i = _f(gf(ap(r.content).toString("utf8")).data, "name") ?? e.directory;
		} catch {
			Z("A bundled SKILL.md has invalid frontmatter.");
		}
		i !== e.name && Z("A bundled skill name does not match its SKILL.md or directory.");
	}
	if (s.size !== a.size && Z("The bundle is missing a referenced skill package."), r.version === 2) {
		let e = r.chain.agent;
		if (e === void 0 != (r.agents.length === 0) && Z("The bundle agent inventory does not match the selected native agent."), e !== void 0) {
			let t = r.agents[0];
			t !== void 0 && t.name === e.name && t.harness === e.harness && t.agentPath === e.agentPath && t.fingerprint === e.fingerprint && up(t.agentPath, t.harness) || Z("The bundled native agent does not match the chain selection.");
			let n = ap(t.content);
			if (l += n.length, u += 1, l > 20971520 || u > 2e3) throw new Qf("BUNDLE_TOO_LARGE", "Bundles are limited to 20 MiB and 2,000 files.");
			o("sha256").update(n).digest("hex") !== t.fingerprint && Z("The bundled native agent fingerprint does not match its content.");
		}
	}
	return r;
}
function lp(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
function up(e, t) {
	let n = e.split("/");
	return e.startsWith("/") || e.includes("\\") || n.some((e) => e === "" || e === "." || e === ".." || !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(e) || /[. ]$/.test(e) || $f.test(e) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(e)) ? !1 : t === "opencode" ? e.endsWith(".md") : e.endsWith(".agent.md");
}
// src/portable/runtime.ts
var dp = 1, fp = 8192, pp = 65536, mp = 1e3, hp = 50, gp = /^[a-f0-9-]{36}$/, _p = tc(P().regex(/^[A-Za-z][A-Za-z0-9_]*$/), P().max(16384)), vp = L({
	number: Ls().int().positive(),
	status: rc([
		"running",
		"done",
		"failed",
		"skipped",
		"interrupted"
	]),
	startedAt: Ac({ offset: !0 }),
	finishedAt: Ac({ offset: !0 }).nullable(),
	summary: P().max(fp).nullable(),
	reason: P().max(2e3).nullable()
}), yp = L({
	version: ac(dp),
	id: P().regex(gp),
	revision: Ls().int().positive(),
	projectPath: P().min(1),
	bundleFingerprint: P().regex(/^[a-f0-9]{64}$/),
	bundle: Dc((e) => {
		try {
			return cp(e), !0;
		} catch {
			return !1;
		}
	}),
	actualHost: rc([
		"copilot",
		"opencode",
		"other"
	]),
	hostSwitchConfirmed: Vs(),
	progression: rc(["supervised", "agent"]),
	progressionConfirmed: Vs(),
	sessionDecision: L({
		requested: rc([
			"shared",
			"fresh",
			"fork"
		]),
		mechanism: rc([
			"current-conversation",
			"isolated-worker",
			"native-fork",
			"handoff"
		]),
		description: P().trim().min(1).max(500),
		confirmed: Vs()
	}),
	resolvedInputs: _p,
	installedSkills: I(L({
		name: P(),
		directory: P(),
		fingerprint: P().regex(/^[a-f0-9]{64}$/),
		reused: Vs()
	})),
	status: rc([
		"ready",
		"running",
		"paused",
		"failed",
		"completed",
		"aborted",
		"interrupted"
	]),
	currentStepIndex: Ls().int().min(0),
	resumeRequired: Vs(),
	steps: I(L({
		id: P().min(1),
		index: Ls().int().min(0),
		attempts: I(vp).max(hp)
	})).min(1).max(mp),
	createdAt: Ac({ offset: !0 }),
	updatedAt: Ac({ offset: !0 })
}), bp = class extends Error {
	code;
	constructor(e, t) {
		super(t), this.code = e, this.name = "PortableRunError";
	}
};
function Q(e, t) {
	throw new bp(e, t);
}
function $() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function xp(e) {
	return o("sha256").update(e).digest("hex");
}
function Sp(t) {
	let n = o("sha256"), r = /* @__PURE__ */ new Set(), i = new Map(t.map((e) => [e.path, e]));
	for (let e of t) {
		let t = e.path.split("/");
		for (t.pop(); t.length > 0;) r.add(t.join("/")), t.pop();
	}
	function a(t) {
		let o = /* @__PURE__ */ new Set();
		for (let e of r) Cp(e) === t && o.add(e);
		for (let e of i.keys()) Cp(e) === t && o.add(e);
		for (let t of [...o].sort((t, n) => e(t).localeCompare(e(n)))) if (r.has(t)) n.update(t).update("\0d\0"), a(t);
		else {
			let e = i.get(t);
			n.update(t).update("\0f\0").update(e.executable ? "1" : "0").update("\0"), n.update(ap(e.content)).update("\0");
		}
	}
	return a(""), n.digest("hex");
}
function Cp(e) {
	let t = e.lastIndexOf("/");
	return t < 0 ? "" : e.slice(0, t);
}
function wp(e, t) {
	let n = _p.safeParse(t ?? {});
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
function Tp(e, t, n) {
	let r = e.chain.steps[t];
	r || Q("STEP_NOT_FOUND", "No active chain step exists.");
	let i = r.instruction.replace(/\{\{([^{}]*)\}\}/g, (e, t) => {
		let r = t.trim();
		return Object.hasOwn(n, r) || Q("INPUT_UNRESOLVED", `Input "${r}" has no resolved value.`), n[r];
	});
	return r.kind === "instruction" ? `Instruction:\n${i}` : `Skill: ${r.skillName}\n\nInstruction:\n${i}`;
}
async function Ep(e) {
	try {
		await f(e, { mode: 448 });
	} catch (e) {
		if (!Dp(e, "EEXIST")) throw e;
	}
	let t = await d(e);
	(!t.isDirectory() || t.isSymbolicLink() || await g(e) !== e) && Q("PATH_UNSAFE", "A required directory is not a real directory.");
}
function Dp(e, t) {
	return e instanceof Error && "code" in e && e.code === t;
}
async function Op(e) {
	n(e) || Q("PROJECT_INVALID", "The project path must be absolute.");
	let t = await g(e);
	return (await y(t)).isDirectory() || Q("PROJECT_INVALID", "The project path is not a directory."), t;
}
async function kp(e) {
	let t = r(e, ".agents"), n = r(t, "skills");
	return await Ep(t), await Ep(n), n;
}
async function Ap(e) {
	let t = o("sha256");
	async function n(e, i) {
		let a = await h(e, { withFileTypes: !0 });
		a.sort((e, t) => e.name.localeCompare(t.name));
		for (let o of a) {
			let a = r(e, o.name), s = i === "" ? o.name : `${i}/${o.name}`, c = await d(a);
			c.isSymbolicLink() && Q("PACKAGE_UNSAFE", "An installed skill contains a symbolic link."), c.isDirectory() ? (t.update(s).update("\0d\0"), await n(a, s)) : c.isFile() ? (t.update(s).update("\0f\0").update(c.mode & 73 ? "1" : "0").update("\0"), t.update(await m(a)).update("\0")) : Q("PACKAGE_UNSAFE", "An installed skill contains a special file.");
		}
	}
	return await n(e, ""), t.digest("hex");
}
async function jp(e, n, o, s) {
	let u = await kp(n), h = new Set(o);
	(h.size !== o.length || [...h].some((t) => !e.skills.some((e) => e.name === t))) && Q("REUSE_INVALID", "Reuse choices must name distinct skills included in the bundle.");
	let g = [], _ = [];
	try {
		for (let n of e.skills) {
			let e = r(u, n.directory);
			(i(u, e).startsWith(`..${a}`) || i(u, e) === "..") && Q("PATH_UNSAFE", "A skill destination escapes the project skill directory.");
			let o = !1;
			try {
				await d(e), o = !0;
			} catch (e) {
				if (!Dp(e, "ENOENT")) throw e;
			}
			if (o) {
				let t = await d(e);
				t.isDirectory() && !t.isSymbolicLink() && h.has(n.name) || Q("PACKAGE_CONFLICT", `Skill "${n.name}" already exists. Review it and explicitly choose reuse or cancel.`);
				let i = r(e, "SKILL.md"), a = await d(i);
				(!a.isFile() || a.isSymbolicLink()) && Q("PACKAGE_CONFLICT", `Existing "${n.name}" is not a valid skill package.`), (_f(gf(await m(i, "utf8")).data, "name") ?? n.directory) !== n.name && Q("PACKAGE_CONFLICT", `Existing skill directory does not contain "${n.name}".`);
				let o = await Ap(e);
				o !== Sp(n.files) && !s && Q("REUSE_CONTENT_CONFIRMATION_REQUIRED", `Existing "${n.name}" differs from the bundle; explicitly confirm reuse of its installed contents.`), g.push({
					name: n.name,
					directory: n.directory,
					fingerprint: o,
					reused: !0
				});
			} else {
				h.has(n.name) && Q("REUSE_MISSING", `Skill "${n.name}" selected for reuse is missing.`), await f(e, { mode: 493 }), _.push(e);
				for (let o of n.files) {
					let n = r(e, ...o.path.split("/")), s = t(n), u = i(e, s).split(a).filter(Boolean), d = e;
					for (let e of u) d = r(d, e), await Ep(d);
					let f = await p(n, c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW, o.executable ? 493 : 420);
					try {
						await f.writeFile(ap(o.content)), await f.sync();
					} finally {
						await f.close();
					}
					await l(n, o.executable ? 493 : 420);
				}
				g.push({
					name: n.name,
					directory: n.directory,
					fingerprint: await Ap(e),
					reused: !1
				});
			}
		}
		return {
			installedSkills: g,
			createdDirectories: _
		};
	} catch (e) {
		throw await Promise.all(_.map((e) => v(e, {
			recursive: !0,
			force: !0
		}))), e instanceof bp || e instanceof Qf ? e : new bp("INSTALL_FAILED", "Skill installation failed; newly created package directories were rolled back.");
	}
}
async function Mp(e) {
	let t = r(e, ".loom"), n = r(t, "portable-runs");
	await Ep(t), await Ep(n);
	let i = r(t, ".gitignore");
	try {
		let e = await p(i, c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW, 384);
		try {
			await e.writeFile("portable-runs/\n", "utf8"), await e.sync();
		} finally {
			await e.close();
		}
	} catch (e) {
		if (!Dp(e, "EEXIST")) throw e;
		let t = await d(i);
		(!t.isFile() || t.isSymbolicLink()) && Q("PATH_UNSAFE", "The Loom ignore file is not a regular file.");
		let n = await m(i, "utf8");
		n.split(/\r?\n/).some((e) => e.trim() === "portable-runs/") || await Np(i, `${n}${n.endsWith("\n") || n === "" ? "" : "\n"}portable-runs/\n`);
	}
	return n;
}
async function Np(e, n, i = !1) {
	let a = r(t(e), `.${s()}.tmp`);
	try {
		let r = await p(a, c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW, 384);
		try {
			await r.writeFile(`${JSON.stringify(n, null, 2)}\n`, "utf8"), await r.sync();
		} finally {
			await r.close();
		}
		i ? (await u(a, e), await ee(a)) : await _(a, e), await Pp(t(e));
	} catch (e) {
		throw await v(a, { force: !0 }), e;
	}
}
async function Pp(e) {
	let t = await p(e, c.O_RDONLY);
	try {
		try {
			await t.sync();
		} catch (e) {
			if (!Dp(e, "EINVAL") && !Dp(e, "EISDIR") && !Dp(e, "EPERM") && !Dp(e, "ENOTSUP")) throw e;
		}
	} finally {
		await t.close();
	}
}
async function Fp(e, t) {
	let n = r(e, ".lock"), i;
	try {
		i = await p(n, c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW, 384);
	} catch (e) {
		throw Dp(e, "EEXIST") && Q("RUN_LOCKED", "Another helper process is mutating portable run state; retry after it exits."), e;
	}
	try {
		return await i.writeFile(`${process.pid}\n`, "utf8"), await i.sync(), await t();
	} finally {
		await i.close(), await v(n, { force: !0 });
	}
}
async function Ip(e, t) {
	let n = await d(e);
	(!n.isFile() || n.isSymbolicLink() || n.size > 31457280) && Q("RUN_FILE_INVALID", "The portable run record is unsafe or exceeds its size limit.");
	let r = yp.safeParse(JSON.parse(await m(e, "utf8")));
	r.success && r.data.projectPath === t || Q("RUN_FILE_INVALID", "The portable run record is corrupt, unsupported, or belongs to another project.");
	let i = cp(r.data.bundle);
	return (xp(JSON.stringify(i)) !== r.data.bundleFingerprint || i.chain.steps.length !== r.data.steps.length || i.chain.steps.some((e, t) => r.data.steps[t]?.id !== e.id)) && Q("RUN_FILE_INVALID", "The portable run snapshot does not match its stored fingerprint or step list."), r.data;
}
async function Lp(e, t) {
	for (let n of e.installedSkills) {
		let e = r(t, ".agents", "skills", n.directory), i = await d(e);
		(!i.isDirectory() || i.isSymbolicLink() || await Ap(e) !== n.fingerprint) && Q("PACKAGE_CHANGED", `Installed skill "${n.name}" changed since this run was prepared; review it and prepare a new run.`);
	}
}
function Rp(e, t) {
	return gp.test(t) || Q("RUN_ID_INVALID", "The run id is not safe."), r(e, `${t}.json`);
}
async function zp(e) {
	return e === void 0 ? {} : ((typeof e != "object" || !e || Array.isArray(e)) && Q("REQUEST_INVALID", "The request must be a JSON object."), e);
}
async function Bp(e, t, n = !1) {
	let r = yp.safeParse(t);
	r.success || Q("RUN_STATE_INVALID", "The portable run transition would produce invalid state."), Buffer.byteLength(JSON.stringify(r.data), "utf8") > 31457280 && Q("RUN_TOO_LARGE", "The portable run record exceeds the 30 MiB safety limit."), await Np(Rp(e, t.id), r.data, n);
}
async function Vp(e) {
	if (e.command === "inspect") {
		e.bundlePath && n(e.bundlePath) || Q("BUNDLE_PATH_INVALID", "Provide an absolute bundle file path.");
		let t = await d(e.bundlePath);
		(!t.isFile() || t.isSymbolicLink() || t.size > 31457280) && Q("BUNDLE_INVALID", "The bundle is not a regular file or exceeds the size limit.");
		let i = cp(JSON.parse(await m(e.bundlePath, "utf8")));
		i.chain.steps.length > mp && Q("CHAIN_TOO_LARGE", `Portable chains are limited to ${String(mp)} steps.`);
		let a = e.projectPath ? await Op(e.projectPath) : null, o = [];
		for (let e of i.skills) {
			let t = null;
			if (a !== null) {
				let n = r(a, ".agents", "skills", e.directory);
				try {
					let e = await d(n);
					t = e.isDirectory() && !e.isSymbolicLink() ? await Ap(n) : "unsafe";
				} catch (e) {
					if (!Dp(e, "ENOENT")) throw e;
				}
			}
			o.push({
				name: e.name,
				directory: e.directory,
				files: e.files.map((e) => ({
					path: e.path,
					bytes: ap(e.content).length,
					executable: e.executable
				})),
				skillMarkdown: Buffer.from(e.files.find((e) => e.path === "SKILL.md").content, "base64").toString("utf8"),
				existingFingerprint: t,
				bundledFingerprint: Sp(e.files)
			});
		}
		let s = i.version === 2 ? await Promise.all(i.agents.map(async (e) => {
			let t = null;
			if (a !== null) {
				let n = e.harness === "opencode" ? ".opencode/agents" : ".github/agents", i = r(a, n, e.agentPath);
				try {
					let e = await d(i);
					t = e.isFile() && !e.isSymbolicLink() && await g(i) === i ? xp(await m(i)) : "unsafe";
				} catch (e) {
					if (!Dp(e, "ENOENT")) throw e;
				}
			}
			return {
				name: e.name,
				harness: e.harness,
				agentPath: e.agentPath,
				fingerprint: e.fingerprint,
				content: ap(e.content).toString("utf8"),
				existingFingerprint: t
			};
		})) : [];
		return {
			ok: !0,
			chain: i.chain,
			bundleFingerprint: xp(JSON.stringify(i)),
			skills: o,
			agents: s
		};
	}
	e.projectPath && n(e.projectPath) || Q("PROJECT_INVALID", "Provide an absolute project path.");
	let t = await Op(e.projectPath), i = await zp(e.input);
	if (e.command === "prepare") {
		e.bundlePath && n(e.bundlePath) || Q("BUNDLE_PATH_INVALID", "Provide an absolute bundle file path."), i.installConfirmed !== !0 && Q("INSTALL_CONFIRMATION_REQUIRED", "Review and explicitly confirm package installation first.");
		let r = await d(e.bundlePath);
		(!r.isFile() || r.isSymbolicLink() || r.size > 31457280) && Q("BUNDLE_INVALID", "The bundle is not a regular file or exceeds the size limit.");
		let a = cp(JSON.parse(await m(e.bundlePath, "utf8")));
		a.chain.steps.length > mp && Q("CHAIN_TOO_LARGE", `Portable chains are limited to ${String(mp)} steps.`);
		let o = sp(a);
		o.agent !== void 0 && Q("NATIVE_AGENT_REQUIRES_LOOM", "This bundle selects a harness-native agent. The portable current-conversation runner cannot switch agents; import the bundle into Skill Loom to run it with the selected agent.");
		let c = wp(a, i.inputs);
		for (let e = 0; e < a.chain.steps.length; e += 1) Buffer.byteLength(Tp(a, e, c), "utf8") > pp && Q("INSTRUCTION_TOO_LARGE", "Resolved step instructions are limited to 64 KiB.");
		let l = i.progression === "agent" ? "agent" : i.progression === "supervised" ? "supervised" : null;
		l === null && Q("PROGRESSION_INVALID", "Choose supervised or agent progression."), l === "agent" && i.progressionConfirmed !== !0 && Q("PROGRESSION_CONFIRMATION_REQUIRED", "Agent-driven progression needs explicit consent.");
		let u = i.actualHost === "copilot" || i.actualHost === "opencode" || i.actualHost === "other" ? i.actualHost : null;
		u === null && Q("HOST_INVALID", "Identify the current host as copilot, opencode, or other.");
		let f = i.hostSwitchConfirmed === !0;
		a.chain.harness !== u && !f && Q("HOST_SWITCH_CONFIRMATION_REQUIRED", "The current host differs from the bundle harness; explicitly confirm compatibility review.");
		let p = i.sessionDecision;
		(typeof p != "object" || !p || Array.isArray(p)) && Q("SESSION_DECISION_REQUIRED", "Describe the verified host session mechanism before preparation.");
		let h = p, g = yp.shape.sessionDecision.safeParse(h);
		g.success && g.data.requested === a.chain.sessionMode || Q("SESSION_DECISION_INVALID", "The session decision must match the bundle and name an actual host mechanism."), (a.chain.sessionMode === "fresh" && g.data.mechanism === "current-conversation" || a.chain.sessionMode === "fork" && g.data.mechanism === "handoff") && g.data.confirmed !== !0 && Q("SESSION_CONFIRMATION_REQUIRED", "A non-native session approximation requires explicit consent."), a.chain.sessionMode === "shared" && g.data.mechanism !== "current-conversation" && Q("SESSION_DECISION_INVALID", "A shared chain must use the current host conversation."), a.chain.sessionMode === "fresh" && !["isolated-worker", "current-conversation"].includes(g.data.mechanism) && Q("SESSION_DECISION_INVALID", "Fresh mode needs a verified isolated worker or an explicitly accepted shared approximation."), a.chain.sessionMode === "fork" && !["native-fork", "handoff"].includes(g.data.mechanism) && Q("SESSION_DECISION_INVALID", "Fork mode needs a verified native fork or an explicitly accepted handoff."), i.installConfirmed !== !0 && Q("INSTALL_CONFIRMATION_REQUIRED", "Review and explicitly confirm package installation first.");
		let _ = i.reuseSkills === void 0 ? [] : i.reuseSkills;
		(!Array.isArray(_) || _.some((e) => typeof e != "string")) && Q("REUSE_INVALID", "Reuse choices must be a list of skill names.");
		let y = await Mp(t);
		return Fp(y, async () => {
			let { installedSkills: e, createdDirectories: n } = await jp(a, t, _, i.differingReuseConfirmed === !0), r = $(), d = s(), p = {
				version: dp,
				id: d,
				revision: 1,
				projectPath: t,
				bundleFingerprint: xp(JSON.stringify(a)),
				bundle: a,
				actualHost: u,
				hostSwitchConfirmed: f,
				progression: l,
				progressionConfirmed: i.progressionConfirmed === !0,
				sessionDecision: g.data,
				resolvedInputs: c,
				installedSkills: e,
				status: "ready",
				currentStepIndex: 0,
				resumeRequired: !1,
				steps: o.steps.map((e, t) => ({
					id: e.id,
					index: t,
					attempts: []
				})),
				createdAt: r,
				updatedAt: r
			};
			try {
				await Bp(y, p, !0);
			} catch (e) {
				throw await Promise.all(n.map((e) => v(e, {
					recursive: !0,
					force: !0
				}))), e;
			}
			return {
				ok: !0,
				runId: d,
				revision: p.revision,
				status: p.status,
				installedSkills: e
			};
		});
	}
	let a = await Mp(t);
	e.runId || Q("RUN_ID_INVALID", "Provide a run id.");
	let o = Rp(a, e.runId), c = await Ip(o, t);
	if (e.command === "status") return {
		ok: !0,
		run: {
			id: c.id,
			revision: c.revision,
			chainName: c.bundle.chain.name,
			bundleFingerprint: c.bundleFingerprint,
			actualHost: c.actualHost,
			progression: c.progression,
			sessionDecision: c.sessionDecision,
			hostSwitchConfirmed: c.hostSwitchConfirmed,
			installedSkills: c.installedSkills,
			status: c.status,
			currentStepIndex: c.currentStepIndex,
			resumeRequired: c.resumeRequired,
			steps: c.steps,
			createdAt: c.createdAt,
			updatedAt: c.updatedAt
		}
	};
	if (e.command === "step") return Fp(a, async () => {
		let e = await Ip(o, t);
		i.revision !== e.revision && Q("REVISION_CONFLICT", "Portable run state changed; refresh status before acting."), (e.status !== "ready" || e.resumeRequired) && Q("RUN_NOT_READY", "The run is not ready to start another step."), await Lp(e, t), e.progression === "supervised" && i.confirmed !== !0 && Q("STEP_CONFIRMATION_REQUIRED", "Confirm this step before execution.");
		let n = e.bundle.chain.steps[e.currentStepIndex], s = e.steps[e.currentStepIndex];
		n && s || Q("RUN_STATE_INVALID", "The current step is missing."), s.attempts.length >= hp && Q("ATTEMPTS_EXHAUSTED", `A step can have at most ${String(hp)} attempts.`), s.attempts.at(-1)?.status === "running" && Q("STEP_ALREADY_RUNNING", "The current step already has an unresolved attempt.");
		let c = {
			number: s.attempts.length + 1,
			status: "running",
			startedAt: $(),
			finishedAt: null,
			summary: null,
			reason: null
		};
		s.attempts.push(c), e.status = "running", e.revision += 1, e.updatedAt = $(), await Bp(a, e);
		let l = Tp(e.bundle, e.currentStepIndex, e.resolvedInputs), u = null;
		if (e.bundle.chain.sessionMode === "fork" && e.sessionDecision.mechanism === "handoff" && e.currentStepIndex > 0) {
			let t = e.bundle.chain.steps[e.currentStepIndex - 1], n = e.steps[e.currentStepIndex - 1]?.attempts.at(-1), r = Tp(e.bundle, e.currentStepIndex - 1, e.resolvedInputs);
			u = [
				"Portable handoff (not a native session fork):",
				`Previous step: ${String(e.currentStepIndex)} "${bf(t)}"`,
				`Previous instruction: ${r.slice(0, 2e3)}`,
				`Recorded status: ${n?.status ?? "unknown"}`,
				`Recorded summary: ${(n?.summary ?? "No summary recorded.").slice(0, 4e3)}`
			].join("\n");
		}
		let d = e.installedSkills.find((e) => e.name === ("skillName" in n ? n.skillName : ""));
		return {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			attempt: c.number,
			step: {
				index: e.currentStepIndex,
				count: e.steps.length,
				id: n.id,
				label: bf(n),
				kind: n.kind === "instruction" ? "instruction" : "skill",
				skillName: "skillName" in n ? n.skillName : null,
				skillPath: d ? r(t, ".agents", "skills", d.directory) : null,
				instruction: l,
				handoffNote: u
			},
			progression: e.progression,
			sessionDecision: e.sessionDecision
		};
	});
	if (e.command === "record") return Fp(a, async () => {
		let e = await Ip(o, t);
		if (i.revision !== e.revision && Q("REVISION_CONFLICT", "Portable run state changed; refresh status before acting."), i.action === "pause" || i.action === "abort") return e.status !== "ready" && e.status !== "paused" && Q("RUN_ACTION_INVALID", "Pause or abort is only available between steps."), e.status = i.action === "pause" ? "paused" : "aborted", e.revision += 1, e.updatedAt = $(), await Bp(a, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status
		};
		if (i.action === "retry") {
			let t = e.steps[e.currentStepIndex]?.attempts.at(-1);
			return (e.status !== "paused" || t?.status !== "failed") && Q("RETRY_NOT_AVAILABLE", "Retry is available only for the current failed step."), e.status = "ready", e.revision += 1, e.updatedAt = $(), await Bp(a, e), {
				ok: !0,
				runId: e.id,
				revision: e.revision,
				status: e.status
			};
		}
		if (i.action === "skip") {
			let t = e.steps[e.currentStepIndex];
			return e.status === "ready" && t && typeof i.reason == "string" && i.reason.trim() !== "" || Q("SKIP_REASON_REQUIRED", "Skipping a pending step requires a reason."), e.progression === "supervised" && i.confirmed !== !0 && Q("STEP_CONFIRMATION_REQUIRED", "Confirm skipping this step."), t.attempts.push({
				number: t.attempts.length + 1,
				status: "skipped",
				startedAt: $(),
				finishedAt: $(),
				summary: null,
				reason: i.reason.slice(0, 2e3)
			}), e.currentStepIndex += 1, e.status = e.currentStepIndex >= e.steps.length ? "completed" : "ready", e.revision += 1, e.updatedAt = $(), await Bp(a, e), {
				ok: !0,
				runId: e.id,
				revision: e.revision,
				status: e.status
			};
		}
		let n = e.steps[e.currentStepIndex], r = n?.attempts.at(-1);
		n && r && r.status === "running" && e.status === "running" || Q("STEP_NOT_RUNNING", "There is no active step attempt to record.");
		let s = i.outcome;
		s !== "done" && s !== "failed" && s !== "skipped" && Q("OUTCOME_INVALID", "Record done, failed, or skipped."), s === "skipped" && (typeof i.reason != "string" || i.reason.trim() === "") && Q("SKIP_REASON_REQUIRED", "Skipping a step requires a reason."), s === "done" && e.progression === "supervised" && i.confirmed !== !0 && Q("COMPLETION_CONFIRMATION_REQUIRED", "Confirm the step outcome before marking it done.");
		let c = typeof i.summary == "string" ? i.summary : "";
		return Buffer.byteLength(c, "utf8") > fp && Q("SUMMARY_TOO_LARGE", "Step summaries are limited to 8 KiB; do not store a transcript."), r.status = s, r.finishedAt = $(), r.summary = c || null, r.reason = s === "skipped" ? i.reason.slice(0, 2e3) : null, s === "failed" ? e.status = "paused" : (e.currentStepIndex += 1, e.status = e.currentStepIndex >= e.steps.length ? "completed" : "ready"), e.revision += 1, e.updatedAt = $(), await Bp(a, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status,
			currentStepIndex: e.currentStepIndex
		};
	});
	if (e.command === "resume") return Fp(a, async () => {
		let e = await Ip(o, t);
		if (i.revision !== e.revision && Q("REVISION_CONFLICT", "Portable run state changed; refresh status before acting."), e.status === "paused" && !e.resumeRequired && i.decision === "continue") return e.status = "ready", e.revision += 1, e.updatedAt = $(), await Bp(a, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status
		};
		if (e.status === "running") {
			let t = e.steps[e.currentStepIndex]?.attempts.at(-1);
			return t?.status !== "running" && Q("RUN_STATE_INVALID", "The active run has no in-flight attempt."), t.status = "interrupted", t.finishedAt = $(), e.status = "interrupted", e.resumeRequired = !0, e.revision += 1, e.updatedAt = $(), await Bp(a, e), {
				ok: !0,
				runId: e.id,
				revision: e.revision,
				status: e.status,
				decisionRequired: !0
			};
		}
		e.resumeRequired && e.status === "interrupted" || Q("RESUME_NOT_REQUIRED", "This run has no interrupted attempt requiring recovery.");
		let n = i.decision, r = e.steps[e.currentStepIndex]?.attempts.at(-1);
		if (r && r.status === "interrupted" || Q("RUN_STATE_INVALID", "Interrupted attempt record is missing."), n === "retry") r.reason = "User chose to retry an interrupted attempt; earlier side effects may remain.";
		else if (n === "done") {
			e.progression === "supervised" && i.confirmed !== !0 && Q("COMPLETION_CONFIRMATION_REQUIRED", "Confirm the interrupted step outcome before marking it done.");
			let t = typeof i.summary == "string" ? i.summary : "";
			Buffer.byteLength(t, "utf8") > fp && Q("SUMMARY_TOO_LARGE", "Step summaries are limited to 8 KiB."), r.status = "done", r.summary = t || null, e.currentStepIndex += 1;
		} else n === "failed" ? r.status = "failed" : Q("RESUME_DECISION_REQUIRED", "Choose retry, done, or failed for the interrupted attempt.");
		return e.resumeRequired = !1, e.status = n === "failed" ? "paused" : e.currentStepIndex >= e.steps.length ? "completed" : "ready", e.revision += 1, e.updatedAt = $(), await Bp(a, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status
		};
	});
	Q("COMMAND_INVALID", "Unknown portable run command.");
}
// src/portable/cli.ts
var Hp = [
	"inspect",
	"prepare",
	"status",
	"step",
	"record",
	"resume"
];
function Up(e) {
	let t = e[0];
	if (!Hp.includes(t)) throw new bp("USAGE", `Usage: loom-bundle <${Hp.join("|")}> [--bundle PATH] [--project PATH] [--run-id ID]`);
	let n = { command: t };
	for (let t = 1; t < e.length; t += 1) {
		let r = e[t];
		if (r !== "--bundle" && r !== "--project" && r !== "--run-id") throw new bp("USAGE", `Unknown option "${r}".`);
		let i = e[t + 1];
		if (i === void 0 || i === "" || i.startsWith("--")) throw new bp("USAGE", `Option "${r}" needs a value.`);
		t += 1, r === "--bundle" && (n.bundlePath = i), r === "--project" && (n.projectPath = i), r === "--run-id" && (n.runId = i);
	}
	if (n.command !== "inspect" && n.projectPath === void 0) throw new bp("USAGE", "This command needs --project PATH.");
	if ([
		"status",
		"step",
		"record",
		"resume"
	].includes(n.command) && n.runId === void 0) throw new bp("USAGE", "This command needs --run-id ID.");
	return n;
}
async function Wp(e = process.argv.slice(2), t = {}) {
	let n = t.stdout ?? process.stdout, r = t.stderr ?? process.stderr;
	try {
		let r = Up(e), i = r.command === "inspect" ? "" : await Gp(t.stdin ?? process.stdin);
		i.trim() !== "" && (r.input = JSON.parse(i));
		let a = await Vp(r);
		return n.write(`${JSON.stringify(a)}\n`), 0;
	} catch (e) {
		let t = e instanceof bp || e instanceof Qf ? e.code : e instanceof SyntaxError ? "JSON_INVALID" : "REQUEST_FAILED", n = e instanceof bp || e instanceof Qf ? e.message : e instanceof SyntaxError ? "Structured helper input is not valid JSON." : "The portable helper could not complete the request. Check file permissions and retry.";
		return r.write(`${JSON.stringify({
			ok: !1,
			error: {
				code: t,
				message: n
			}
		})}\n`), 1;
	}
}
async function Gp(e) {
	if (e === void 0 || "isTTY" in e && e.isTTY === !0) return "";
	let t = [], n = 0;
	for await (let r of e) {
		let e = Buffer.isBuffer(r) ? r : Buffer.from(String(r));
		if (n += e.length, n > 8388608) throw new bp("REQUEST_TOO_LARGE", "Structured helper input is limited to 8 MiB.");
		t.push(e);
	}
	return Buffer.concat(t).toString("utf8");
}
process.argv[1] !== void 0 && ["loom-bundle.mjs", "cli.js"].includes(e(process.argv[1])) && Wp().then((e) => {
	e !== 0 && (process.exitCode = e);
});
export { Up as parsePortableArgs, Wp as runPortableCli };
