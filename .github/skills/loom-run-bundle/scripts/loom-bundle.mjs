#!/usr/bin/env node
import { constants as e, realpathSync as t } from "node:fs";
import { basename as n, dirname as r, isAbsolute as i, join as a, relative as o, resolve as s, sep as c } from "node:path";
import { getSystemErrorMap as l } from "node:util";
import { fileURLToPath as u } from "node:url";
import { createHash as d, randomUUID as f } from "node:crypto";
import { link as p, lstat as m, mkdir as h, open as g, opendir as _, realpath as v, rename as y, rm as ee, stat as b, unlink as x } from "node:fs/promises";
import { DatabaseSync as te } from "node:sqlite";
// node_modules/zod/v4/core/util.js
function ne(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return Object.entries(e).filter(([e, n]) => t.indexOf(+e) === -1).map(([e, t]) => t);
}
function re(e, t = "|") {
	return e.map((e) => De(e)).join(t);
}
function ie(e, t) {
	return typeof t == "bigint" ? t.toString() : t;
}
var ae = class {
	constructor(e) {
		this._getter = e, this._value = void 0;
	}
	get value() {
		let e = this._getter;
		return e !== void 0 && (this._value = e(), this._getter = void 0), this._value;
	}
};
function oe(e) {
	return new ae(e);
}
function se(e) {
	return e == null;
}
function ce(e) {
	let t = +!!e.startsWith("^"), n = e.endsWith("$") ? e.length - 1 : e.length;
	return e.slice(t, n);
}
function le(e, t) {
	let n = e / t, r = Math.round(n), i = 4 * 2 ** -52 * Math.max(Math.abs(n), 1);
	return Math.abs(n - r) < i ? 0 : n - r;
}
function ue(e, t, n) {
	Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
}
function de(e) {
	let t = Object.getOwnPropertyDescriptor(e, "shape");
	return t?.get ? t.get.raw : t?.value;
}
function fe(e) {
	return de(e._zod.def) ?? e._zod.def.shape;
}
function pe(e, t, n) {
	Object.defineProperty(e, t, {
		get() {
			let e = n();
			return ue(this, t, e), e;
		},
		enumerable: !0,
		configurable: !0
	});
}
function me(e, t, n) {
	t in e ? ue(e, t, n) : e[t] = n;
}
function he(e, t, n, r) {
	let i = fe(t);
	for (let a of n) {
		let n = Object.getOwnPropertyDescriptor(i, a);
		n.enumerable && (n.get ? pe(e, a, () => {
			let e = t._zod.def.shape[a];
			return r ? r(e, a) : e;
		}) : me(e, a, r ? r(n.value, a) : n.value));
	}
}
function ge(e, t) {
	for (let n of Reflect.ownKeys(t)) {
		let r = Object.getOwnPropertyDescriptor(t, n);
		r.enumerable && (r.get ? pe(e, n, () => t[n]) : me(e, n, r.value));
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
function _e(e) {
	return JSON.stringify(e);
}
function ve(e) {
	return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var ye = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {};
function be(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var xe = /* @__PURE__*/ oe(() => {
	if (gt.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
	try {
		return Function(""), !0;
	} catch {
		return !1;
	}
});
function Se(e) {
	if (be(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0 || typeof t != "function") return !0;
	let n = t.prototype;
	return be(n) !== !1 && Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") !== !1;
}
function Ce(e) {
	return Se(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
var we = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function Te(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Ee(e, t, n) {
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
function De(e) {
	return typeof e == "bigint" ? e.toString() + "n" : typeof e == "string" ? `"${e}"` : `${e}`;
}
function Oe(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin !== void 0 && e[t]._zod.optout === "optional");
}
var ke = {
	safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}, Ae = {
	int64: [/* @__PURE__*/ BigInt("-9223372036854775808"), /* @__PURE__*/ BigInt("9223372036854775807")],
	uint64: [/* @__PURE__*/ BigInt(0), /* @__PURE__*/ BigInt("18446744073709551615")]
};
function je(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".pick() cannot be used on object schemas containing refinements");
	let i = {};
	return he(i, e, Me(e, t)), Ee(e, S(n, {
		shape: i,
		checks: []
	}));
}
function Me(e, t) {
	let n = fe(e), r = [];
	for (let e of Reflect.ownKeys(t)) {
		if (!Object.getOwnPropertyDescriptor(n, e)?.enumerable) throw Error(`Unrecognized key: "${String(e)}"`);
		t[e] && r.push(e);
	}
	return r;
}
function Ne(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".omit() cannot be used on object schemas containing refinements");
	let i = new Set(Me(e, t)), a = {};
	return he(a, e, Reflect.ownKeys(fe(e)).filter((e) => !i.has(e))), Ee(e, S(n, {
		shape: a,
		checks: []
	}));
}
function Pe(e, t) {
	if (!Se(t)) throw Error("Invalid input to extend: expected a plain object");
	let n = e._zod.def.checks;
	if (n && n.length > 0) {
		let n = fe(e);
		for (let e of Reflect.ownKeys(t)) if (Object.getOwnPropertyDescriptor(n, e) !== void 0) throw Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return Ee(e, S(e._zod.def, { shape: Fe(e, t) }));
}
function Fe(e, t) {
	let n = {};
	return he(n, e, Reflect.ownKeys(fe(e))), ge(n, t), n;
}
function Ie(e, t) {
	if (!Se(t)) throw Error("Invalid input to safeExtend: expected a plain object");
	return Ee(e, S(e._zod.def, { shape: Fe(e, t) }));
}
function Le(e, t) {
	if (!t?._zod?.def) throw Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
	if (e._zod.def.checks?.length) throw Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	let n = {};
	return he(n, e, Reflect.ownKeys(fe(e))), he(n, t, Reflect.ownKeys(fe(t))), Ee(e, S(e._zod.def, {
		shape: n,
		get catchall() {
			return t._zod.def.catchall;
		},
		checks: t._zod.def.checks ?? []
	}));
}
function Re(e, t, n, r = "partial") {
	let i = t._zod.def.checks;
	if (i && i.length > 0) throw Error(`.${r}() cannot be used on object schemas containing refinements`);
	let a = n ? new Set(Me(t, n)) : void 0, o = {};
	return he(o, t, Reflect.ownKeys(fe(t)), e && ((t, n) => a && !a.has(n) ? t : new e({
		type: "optional",
		innerType: t
	}))), Ee(t, S(t._zod.def, {
		shape: o,
		checks: []
	}));
}
function ze(e, t, n) {
	let r = n ? new Set(Me(t, n)) : void 0, i = {};
	return he(i, t, Reflect.ownKeys(fe(t)), (t, n) => r && !r.has(n) ? t : new e({
		type: "nonoptional",
		innerType: t
	})), Ee(t, S(t._zod.def, { shape: i }));
}
function Be(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
	return !1;
}
function Ve(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
	return !1;
}
function He(e, t) {
	return t.map((t) => {
		var n;
		return (n = t).path ?? (n.path = []), t.path.unshift(e), t;
	});
}
function Ue(e) {
	return typeof e == "string" ? e : e?.message;
}
function We(e) {
	let t = [];
	for (let n of e ?? []) {
		let e = n._zod.def;
		if (!/_(length|size)$|_equals$/.test(e.check)) break;
		let r = e.maximum ?? e.length ?? e.size;
		r >= 0 && t.push([r, n]);
	}
	return t;
}
function Ge(e, t, n) {
	var r;
	for (let i = t; i < e.length; i++) (r = e[i]).schema ?? (r.schema = n);
}
function Ke(e, t, n) {
	var r;
	let i = e.inst?._zod?.traits;
	i?.has("$ZodType") && (i.has("$ZodCheck") ? (r = e).schema ?? (r.schema = e.inst) : e.schema = e.inst);
	let a = e.schema === e.inst ? void 0 : e.schema?._zod.def?.error, o = e.message ? e.message : Ue(e.inst?._zod.def?.error?.(e)) ?? Ue(a?.(e)) ?? Ue(t?.error?.(e)) ?? Ue(n.customError?.(e)) ?? Ue(n.localeError?.(e)) ?? "Invalid input", s = {};
	for (let t of Object.keys(e)) t !== "inst" && t !== "schema" && t !== "continue" && t !== "input" && t !== "__proto__" && (s[t] = e[t]);
	return s.path ??= [], s.message = o, t?.reportInput && (s.input = e.input), s;
}
var qe = /[\uD800-\uDBFF]/;
function Je(e) {
	let t = e.length;
	if (!qe.test(e)) return t;
	let n = t;
	for (let r = 0; r < t - 1; r++) (e.charCodeAt(r) & 64512) == 55296 && (e.charCodeAt(r + 1) & 64512) == 56320 && (n--, r++);
	return n;
}
function Ye(e) {
	return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function Xe(e) {
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
function Ze(...e) {
	let [t, n, r] = e;
	return typeof t == "string" ? {
		message: t,
		code: "custom",
		input: n,
		inst: r
	} : { ...t };
}
function Qe(e, t) {
	for (let n in t) {
		let r = Object.getOwnPropertyDescriptor(t, n);
		r.get ? Object.defineProperty(e, n, {
			...r,
			enumerable: !1
		}) : nt(e, n, r.value);
	}
}
function $e(e, t, n, r = !0) {
	return Object.defineProperty(e, t, {
		configurable: !0,
		writable: !0,
		enumerable: r,
		value: n
	}), n;
}
function et(e, t, n) {
	return $e(e, t, n, !1);
}
/* @__NO_SIDE_EFFECTS__ */
function tt(e, t) {
	for (let n in e) {
		let r = e[n];
		Object.defineProperty(t, n, {
			configurable: !0,
			enumerable: !0,
			get() {
				return $e(this, n, r(this));
			},
			set(e) {
				$e(this, n, e);
			}
		});
	}
	return t;
}
function nt(e, t, n) {
	Object.defineProperty(e, t, {
		configurable: !0,
		get() {
			return this == null ? n : $e(this, t, n.bind(this));
		},
		set(e) {
			$e(this, t, e);
		}
	});
}
function rt(e, t) {
	let n = Object.getPrototypeOf(e);
	return t in n ? void 0 : n;
}
var it, at = !1, ot = {
	configurable: !0,
	get() {
		at = !0;
	}
};
function w(e, t, n) {
	let r = Object.getPrototypeOf(e._zod);
	t in r && it !== e._zod ? it = void 0 : (it = e._zod, Object.defineProperty(r, t, {
		configurable: !0,
		get() {
			Object.defineProperty(this, t, ot);
			let e = at;
			at = !1;
			try {
				let r = n(this);
				return at ? delete this[t] : Object.defineProperty(this, t, {
					configurable: !0,
					writable: !0,
					value: r
				}), at ||= e, r;
			} catch (n) {
				throw delete this[t], at ||= e, n;
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
function st(e, t, n, r) {
	let i = rt(e, t);
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
var ct = "~constantCatch";
function lt(e) {
	let t = () => e;
	return t[ct] = !0, t;
}
// node_modules/zod/v4/core/core.js
var ut, dt = {
	value: void 0,
	enumerable: !1
}, ft = "captureStackTrace" in Error ? Error : null;
function pt(e) {
	let t = ft;
	if (t) {
		let n = t.stackTraceLimit;
		if (typeof n == "number") {
			try {
				t.stackTraceLimit = 0;
			} catch {
				return ft = null, new e();
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
			dt.value = new a(r);
			try {
				Object.defineProperty(n, "_zod", dt);
			} finally {
				dt.value = void 0;
			}
		} else if (n._zod.traits.has(e)) return;
		if (n._zod.traits.add(e), t(n, r), s) {
			let e = Object.getPrototypeOf(n), t = n._zod.constr.prototype, r = e;
			for (; r && r !== t;) r = Object.getPrototypeOf(r);
			let i = r ?? e;
			s.has(i) || (s.add(i), Qe(i, o));
		}
		let i = d.prototype;
		for (let e in i) Object.prototype.hasOwnProperty.call(i, e) && (e in n || (n[e] = i[e].bind(n)));
	}
	let l = r?.Parent ?? Object;
	class u extends l {}
	Object.defineProperty(u, "name", { value: e });
	function d(e) {
		let t = r?.Parent ? pt(u) : this;
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
var mt = class extends Error {
	constructor() {
		super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
	}
}, ht = class extends Error {
	constructor(e) {
		super(`Encountered unidirectional transform during encode: ${e}`), this.name = "ZodEncodeError";
	}
};
(ut = globalThis).__zod_globalConfig ?? (ut.__zod_globalConfig = {});
var gt = globalThis.__zod_globalConfig;
function _t(e) {
	return e && Object.assign(gt, e), gt;
}
// node_modules/zod/v4/core/errors.js
function vt() {
	let e = this._zod;
	return e.message ??= JSON.stringify(e.def, ie, 2), e.message;
}
function yt(e) {
	this._zod.message = e;
}
var bt = {
	get: vt,
	set: yt,
	enumerable: !0,
	configurable: !0
}, xt = {
	value: void 0,
	enumerable: !1
}, St = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]), Ct = /* @__PURE__ */ T("$ZodError", (e, t) => {
	e.name = "$ZodError", xt.value = t, Object.defineProperty(e, "issues", xt), xt.value = void 0, Object.defineProperty(e, "message", bt);
	let n = Object.getPrototypeOf(e);
	St.has(n) || (St.add(n), Object.defineProperty(n, "toString", {
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
function wt(e, t, n) {
	return Object.prototype.hasOwnProperty.call(e, t) || (t === "__proto__" ? Object.defineProperty(e, t, {
		value: n(),
		writable: !0,
		enumerable: !0,
		configurable: !0
	}) : e[t] = n()), e[t];
}
function Tt(e, t = (e) => e.message) {
	let n = {}, r = [];
	for (let i of e.issues) i.path.length > 0 ? wt(n, i.path[0], () => []).push(t(i)) : r.push(t(i));
	return {
		formErrors: r,
		fieldErrors: n
	};
}
function Et(e, t = (e) => e.message) {
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
function Dt(e, t) {
	return {
		callee: t?.callee ?? e,
		Err: t?.Err
	};
}
var Ot = (e) => {
	let t = (n, r, i, a) => {
		let o = i ? {
			...i,
			async: !1
		} : { async: !1 }, s = n._zod.run({
			value: r,
			issues: []
		}, o);
		if (s instanceof Promise) throw new mt();
		if (s.issues.length) {
			let n = new ((a?.Err) ?? e)(s.issues.map((e) => Ke(e, o, _t())));
			throw ye(n, a?.callee ?? t), n;
		}
		return s.value;
	};
	return t;
}, kt = (e) => {
	let t = async (n, r, i, a) => {
		let o = i ? {
			...i,
			async: !0
		} : { async: !0 }, s = n._zod.run({
			value: r,
			issues: []
		}, o);
		if (s instanceof Promise && (s = await s), s.issues.length) {
			let n = new ((a?.Err) ?? e)(s.issues.map((e) => Ke(e, o, _t())));
			throw ye(n, a?.callee ?? t), n;
		}
		return s.value;
	};
	return t;
}, At = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		async: !1
	} : { async: !1 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	if (a instanceof Promise) throw new mt();
	return a.issues.length ? jt(e, a.issues, i) : {
		success: !0,
		data: a.value
	};
};
function jt(e, t, n) {
	let r;
	return {
		success: !1,
		get error() {
			return r || (r = new e(t.map((e) => Ke(e, n, _t()))), t = void 0, n = void 0), r;
		},
		set error(e) {
			r = e, t = void 0, n = void 0;
		}
	};
}
var Mt = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		async: !0
	} : { async: !0 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	return a instanceof Promise && (a = await a), a.issues.length ? jt(e, a.issues, i) : {
		success: !0,
		data: a.value
	};
}, Nt = /* @__PURE__ */ Symbol.for("zod.compile.invalid"), Pt = /* @__PURE__ */ Symbol.for("zod.compile.fallback"), Ft = ((e, t, n) => {
	let r = e._zod.bag.validator;
	if (r !== void 0) {
		if (r(t) !== Nt) return !0;
		if (r.definite === !0 && n === void 0) return !1;
	}
	return It(e, t, n);
});
function It(e, t, n) {
	let r = n ? {
		...n,
		async: !1,
		abortEarly: !0
	} : {
		async: !1,
		abortEarly: !0
	}, i = e._zod.bag.fallbackRun, a;
	if (i ? (r[Pt] = !0, a = i({
		value: t,
		issues: []
	}, r)) : a = e._zod.run({
		value: t,
		issues: []
	}, r), a instanceof Promise) throw new mt();
	return a.issues.length === 0;
}
var Lt = async (e, t, n) => {
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
}, Rt = (e) => {
	let t = Ot(e), n = (e, r, i, a) => {
		let o = i ? {
			...i,
			direction: "backward"
		} : { direction: "backward" };
		return t(e, r, o, Dt(n, a));
	};
	return n;
}, zt = (e) => {
	let t = Ot(e), n = (e, r, i, a) => t(e, r, i, Dt(n, a));
	return n;
}, Bt = (e) => {
	let t = kt(e), n = async (e, r, i, a) => {
		let o = i ? {
			...i,
			direction: "backward"
		} : { direction: "backward" };
		return await t(e, r, o, Dt(n, a));
	};
	return n;
}, Vt = (e) => {
	let t = kt(e), n = async (e, r, i, a) => await t(e, r, i, Dt(n, a));
	return n;
}, Ht = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return At(e)(t, n, i);
}, Ut = (e) => (t, n, r) => At(e)(t, n, r), Wt = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return Mt(e)(t, n, i);
}, Gt = (e) => async (t, n, r) => Mt(e)(t, n, r), Kt = /^[cC][0-9a-z]{6,}$/, qt = /^[0-9a-z]+$/, Jt = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/, Yt = /^[0-9a-vA-V]{20}$/, Xt = /^[A-Za-z0-9]{27}$/, Zt = /^[a-zA-Z0-9_-]{21}$/;
function Qt(e) {
	return RegExp(`^[a-zA-Z0-9_-]{${e}}$`);
}
var $t = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, en = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, tn = (e) => e ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, nn = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, rn = "^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$";
function an() {
	return new RegExp(rn, "u");
}
var on = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, sn = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, cn = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, ln = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, un = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, dn = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/, fn = /^https?$/, pn = /^\+[1-9]\d{6,14}$/, mn = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
function hn(e) {
	return RegExp(`^${e}$`);
}
var gn = /*@__PURE__*/ hn(mn);
function _n(e) {
	let t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
	return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : e.seconds ? `${t}:[0-5]\\d(?:\\.\\d+)?` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function vn(e) {
	return RegExp(`^${_n(e)}$`);
}
function yn(e) {
	let t = ["Z"];
	e.offset && t.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
	let n = `${_n({
		precision: e.precision,
		seconds: !0
	})}(?:${t.join("|")})`, r = e.local ? `${n}|${_n({ precision: e.precision })}` : n;
	return RegExp(`^${mn}T(?:${r})$`);
}
var bn = /^[\s\S]{0,}$/, xn = /^-?\d+$/, Sn = /^-?\d+(?:\.\d+)?$/, Cn = /^(?:true|false)$/i, wn = /^[^A-Z]*$/, Tn = /^[^a-z]*$/, E = /*@__PURE__*/ T("$ZodCheck", (e, t) => {
	var n;
	e._zod ??= {}, e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), En = (e) => {
	let t = e.value;
	return !se(t) && t.length !== void 0;
}, Dn = {
	number: "number",
	bigint: "bigint",
	object: "date"
}, On = /*@__PURE__*/ T("$ZodCheckLessThan", (e, t) => {
	E.init(e, t);
	let n = Dn[typeof t.value];
	e._zod.check = (r) => {
		(t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
			origin: Dn[typeof r.value] ?? n,
			code: "too_big",
			maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), kn = /*@__PURE__*/ T("$ZodCheckGreaterThan", (e, t) => {
	E.init(e, t);
	let n = Dn[typeof t.value];
	e._zod.check = (r) => {
		(t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
			origin: Dn[typeof r.value] ?? n,
			code: "too_small",
			minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), An = /*@__PURE__*/ T("$ZodCheckMultipleOf", (e, t) => {
	E.init(e, t), e._zod.check = (n) => {
		if (typeof n.value != typeof t.value) throw Error("Cannot mix number and bigint in multiple_of check.");
		(typeof n.value == "bigint" ? t.value !== BigInt(0) && n.value % t.value === BigInt(0) : le(n.value, t.value) === 0) || n.issues.push({
			origin: typeof n.value,
			code: "not_multiple_of",
			divisor: t.value,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), jn = /*@__PURE__*/ T("$ZodCheckNumberFormat", (e, t) => {
	E.init(e, t), t.format = t.format || "float64";
	let n = t.format?.includes("int"), r = n ? "int" : "number", [i, a] = ke[t.format];
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
}), Mn = /*@__PURE__*/ T("$ZodCheckMaxLength", (e, t) => {
	var n;
	E.init(e, t), (n = e._zod.def).when ?? (n.when = En), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if ((typeof r == "string" && i > t.maximum ? Je(r) : i) <= t.maximum) return;
		let a = Ye(r);
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
}), Nn = /*@__PURE__*/ T("$ZodCheckMinLength", (e, t) => {
	var n;
	E.init(e, t), (n = e._zod.def).when ?? (n.when = En), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if ((typeof r == "string" && i >= t.minimum && i < t.minimum * 2 ? Je(r) : i) >= t.minimum) return;
		let a = Ye(r);
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
}), Pn = /*@__PURE__*/ T("$ZodCheckLengthEquals", (e, t) => {
	var n;
	E.init(e, t), (n = e._zod.def).when ?? (n.when = En), e._zod.check = (n) => {
		let r = n.value, i = r.length, a = typeof r == "string" && i >= t.length && i <= t.length * 2 ? Je(r) : i;
		if (a === t.length) return;
		let o = Ye(r), s = a > t.length;
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
}), Fn = /*@__PURE__*/ T("$ZodCheckStringFormat", (e, t) => {
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
}), In = /*@__PURE__*/ T("$ZodCheckRegex", (e, t) => {
	Fn.init(e, t), e._zod.check = (n) => {
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
}), Ln = /*@__PURE__*/ T("$ZodCheckLowerCase", (e, t) => {
	t.pattern ??= wn, Fn.init(e, t);
}), Rn = /*@__PURE__*/ T("$ZodCheckUpperCase", (e, t) => {
	t.pattern ??= Tn, Fn.init(e, t);
}), zn = /*@__PURE__*/ T("$ZodCheckIncludes", (e, t) => {
	E.init(e, t);
	let n = Te(t.includes);
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
}), Bn = /*@__PURE__*/ T("$ZodCheckStartsWith", (e, t) => {
	E.init(e, t);
	let n = RegExp(`^${Te(t.prefix)}.*`);
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
}), Vn = /*@__PURE__*/ T("$ZodCheckEndsWith", (e, t) => {
	E.init(e, t);
	let n = RegExp(`.*${Te(t.suffix)}$`);
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
}), Hn = /*@__PURE__*/ T("$ZodCheckOverwrite", (e, t) => {
	E.init(e, t), e._zod.check = (e) => {
		e.value = t.tx(e.value);
	};
}), Un = class {
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
}, Wn = {
	major: 4,
	minor: 6,
	patch: 7
}, D = /*@__PURE__*/ T("$ZodType", (e, t) => {
	var n;
	e ??= {}, e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = Wn;
	let r = e._zod.def.checks, i = e._zod.traits.has("$ZodCheck") ? [e, ...r ?? []] : r?.length ? [...r] : [];
	for (let t of i) for (let n of t._zod.onattach) n(e);
	if (i.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
		e._zod.run = e._zod.parse;
	});
	else {
		let t = (t, n, r) => {
			if (t.memo) return t;
			let i = Be(t), a;
			for (let o of n) {
				if (o._zod.def.when) {
					if (Ve(t) || !o._zod.def.when(t)) continue;
				} else if (i) continue;
				let n = t.issues.length, s = o._zod.check(t);
				if (s instanceof Promise && r?.async === !1) throw new mt();
				if (a || s instanceof Promise) a = (a ?? Promise.resolve()).then(async () => {
					await s, t.issues.length !== n && (Ge(t.issues, n, e), i ||= Be(t, n));
				});
				else {
					if (t.issues.length === n) continue;
					Ge(t.issues, n, e), i ||= Be(t, n);
				}
			}
			return a ? a.then(() => t) : t;
		}, n = (n, r, a) => {
			if (Be(n)) return n.aborted = !0, n;
			let o = t(r, i, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new mt();
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
				if (a.async === !1) throw new mt();
				return o.then((e) => t(e, i, a));
			}
			return t(o, i, a);
		};
	}
}, {
	get "~standard"() {
		return et(this, "~standard", qn(this));
	},
	set "~standard"(e) {
		$e(this, "~standard", e);
	}
}), Gn = (e, t) => e.issues.length ? { issues: e.issues.map((e) => Ke(e, t, _t())) } : { value: e.value };
async function Kn(e, t) {
	let n = { async: !0 };
	return Gn(await e._zod.run({
		value: t,
		issues: []
	}, n), n);
}
function qn(e) {
	return {
		validate: (t) => {
			let n = { async: !1 };
			try {
				let r = e._zod.run({
					value: t,
					issues: []
				}, n);
				if (!(r instanceof Promise)) return Gn(r, n);
			} catch {}
			return Kn(e, t);
		},
		vendor: "zod",
		version: 1
	};
}
var Jn = /*@__PURE__*/ T("$ZodString", (e, t) => {
	D.init(e, t), e._zod.pattern = t.pattern ?? bn, e._zod.parse = (n, r) => {
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
	Fn.init(e, t), Jn.init(e, t);
}), Yn = /*@__PURE__*/ T("$ZodGUID", (e, t) => {
	t.pattern ??= en, O.init(e, t);
}), Xn = /*@__PURE__*/ T("$ZodUUID", (e, t) => {
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
		t.pattern ??= tn(e);
	} else t.pattern ??= tn();
	O.init(e, t);
}), Zn = /*@__PURE__*/ T("$ZodEmail", (e, t) => {
	t.pattern ??= nn, O.init(e, t);
});
function Qn(e) {
	try {
		return typeof URL < "u" && typeof URL.canParse == "function" ? URL.canParse(e) : (new URL(e), !0);
	} catch {
		return !1;
	}
}
function $n(e, t) {
	return !("normalize" in t) && !("hostname" in t) && !("protocol" in t) ? Qn(e) || 2 : er(e, t);
}
function er(e, t) {
	if (!t.normalize && t.protocol?.source === fn.source && !/^https?:\/\//i.test(e)) return 1;
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
var tr = /[\t\n\r]/g;
function nr(e) {
	return e.replace(tr, "");
}
function rr(e, t) {
	return t.lastIndex = 0, t.test(e.hostname);
}
function ir(e, t) {
	return t.lastIndex = 0, t.test(e.protocol.endsWith(":") ? e.protocol.slice(0, -1) : e.protocol);
}
var ar = /*@__PURE__*/ T("$ZodURL", (e, t) => {
	O.init(e, t), e._zod.check = (n) => {
		try {
			let r = n.value.trim(), i = $n(r, t);
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
				n.value = nr(r);
				return;
			}
			t.hostname && !rr(i, t.hostname) && n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: t.hostname.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			}), t.protocol && !ir(i, t.protocol) && n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: t.protocol.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			}), n.value = t.normalize ? i.href : nr(r);
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
}), or = /*@__PURE__*/ T("$ZodEmoji", (e, t) => {
	t.pattern ??= an(), O.init(e, t);
}), sr = /*@__PURE__*/ T("$ZodNanoID", (e, t) => {
	if (t.length !== void 0 && (!Number.isInteger(t.length) || t.length < 1)) throw Error(`Invalid nanoid length: ${t.length}`);
	t.pattern ??= t.length === void 0 ? Zt : Qt(t.length), O.init(e, t);
}), cr = /*@__PURE__*/ T("$ZodCUID", (e, t) => {
	t.pattern ??= Kt, O.init(e, t);
}), lr = /*@__PURE__*/ T("$ZodCUID2", (e, t) => {
	t.pattern ??= qt, O.init(e, t);
}), ur = /*@__PURE__*/ T("$ZodULID", (e, t) => {
	t.pattern ??= Jt, O.init(e, t);
}), dr = /*@__PURE__*/ T("$ZodXID", (e, t) => {
	t.pattern ??= Yt, O.init(e, t);
}), fr = /*@__PURE__*/ T("$ZodKSUID", (e, t) => {
	t.pattern ??= Xt, O.init(e, t);
}), pr = /*@__PURE__*/ T("$ZodISODateTime", (e, t) => {
	t.pattern ??= yn(t), O.init(e, t);
}), mr = /*@__PURE__*/ T("$ZodISODate", (e, t) => {
	t.pattern ??= gn, O.init(e, t);
}), hr = /*@__PURE__*/ T("$ZodISOTime", (e, t) => {
	t.pattern ??= vn(t), O.init(e, t);
}), gr = /*@__PURE__*/ T("$ZodISODuration", (e, t) => {
	t.pattern ??= $t, O.init(e, t);
}), _r = /*@__PURE__*/ T("$ZodIPv4", (e, t) => {
	t.pattern ??= on, O.init(e, t);
}), vr = /^[0-9a-fA-F:.]+$/;
function yr(e) {
	return vr.test(e) ? Qn(`http://[${e}]`) : !1;
}
var br = /*@__PURE__*/ T("$ZodIPv6", (e, t) => {
	t.pattern ??= sn, O.init(e, t), e._zod.check = (n) => {
		yr(n.value) || n.issues.push({
			code: "invalid_format",
			format: "ipv6",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), xr = /*@__PURE__*/ T("$ZodCIDRv4", (e, t) => {
	t.pattern ??= cn, O.init(e, t);
});
function Sr(e) {
	let t = e.split("/");
	if (t.length !== 2) return !1;
	let [n, r] = t;
	if (!r) return !1;
	let i = Number(r);
	return `${i}` !== r || i < 0 || i > 128 ? !1 : yr(n);
}
var Cr = /*@__PURE__*/ T("$ZodCIDRv6", (e, t) => {
	t.pattern ??= ln, O.init(e, t), e._zod.check = (n) => {
		Sr(n.value) || n.issues.push({
			code: "invalid_format",
			format: "cidrv6",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
});
function wr(e) {
	if (e === "") return !0;
	if (/\s/.test(e) || e.length % 4 != 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var Tr = /^[0-9a-zA-Z+/]*={0,2}$/, Er = /*@__PURE__*/ T("$ZodBase64", (e, t) => {
	t.pattern ??= Tr, O.init(e, t), e._zod.check = (n) => {
		wr(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Dr = /^[A-Za-z0-9_-]*$/;
function Or(e) {
	if (!Dr.test(e)) return !1;
	let t = e.replace(/[-_]/g, (e) => e === "-" ? "+" : "/");
	return wr(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
var kr = /*@__PURE__*/ T("$ZodBase64URL", (e, t) => {
	t.pattern ??= Dr, O.init(e, t), e._zod.check = (n) => {
		Or(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Ar = /*@__PURE__*/ T("$ZodE164", (e, t) => {
	t.pattern ??= pn, O.init(e, t);
});
function jr(e, t = null) {
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
var Mr = /*@__PURE__*/ T("$ZodJWT", (e, t) => {
	O.init(e, t), e._zod.check = (n) => {
		jr(n.value, t.alg) || n.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Nr = /*@__PURE__*/ T("$ZodNumber", (e, t) => {
	D.init(e, t), e._zod.pattern = Sn, e._zod.parse = (n, r) => {
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
}), Pr = /*@__PURE__*/ T("$ZodNumberFormat", (e, t) => {
	jn.init(e, t), Nr.init(e, t);
}), Fr = /*@__PURE__*/ T("$ZodBoolean", (e, t) => {
	D.init(e, t), e._zod.pattern = Cn, e._zod.parse = (n, r) => {
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
}), Ir = /*@__PURE__*/ T("$ZodUnknown", (e, t) => {
	D.init(e, t), e._zod.parse = (e) => e;
}), Lr = /*@__PURE__*/ T("$ZodNever", (e, t) => {
	D.init(e, t), e._zod.parse = (t, n) => (t.issues.push({
		expected: "never",
		code: "invalid_type",
		input: t.value,
		inst: e
	}), t);
});
function Rr(e, t) {
	let n = We(e._zod.def.checks);
	if (!n.length) return;
	let r = Math.min(...n.map((e) => e[0])), i = e._zod.parse;
	e._zod.parse = (n, a) => {
		let o = t(n.value);
		if (o > r && !a?.skipChecks && a?.direction !== "backward") {
			for (let [t, r] of We(e._zod.def.checks)) if (o > t && r._zod.def.when(n)) {
				let t = n.issues.length;
				return r._zod.check(n), n.issues[t].continue = !1, Ge(n.issues, t, e), n;
			}
		}
		return i(n, a);
	};
}
var zr = (e) => Array.isArray(e) ? e.length : -1;
function Br(e, t, n) {
	e.issues.length && t.issues.push(...He(n, e.issues)), t.value[n] = e.value;
}
var Vr = /*@__PURE__*/ T("$ZodArray", (e, t) => {
	D.init(e, t);
	let n = gt.memoizer;
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
			if (c instanceof Promise) o.push(c.then((t) => Br(t, r, e)));
			else if (Br(c, r, e), s && c.issues.length !== 0 && Be(c)) break;
		}
		return o.length ? Promise.all(o).then(() => r) : r;
	}, Rr(e, zr);
});
function Hr(e, t, n, r, i, a) {
	let o = n in r, s = a === "optional";
	if (o || !s || i !== "optional") {
		if (e.issues.length) {
			if (i !== void 0 && s && !o) return;
			t.issues.push(...He(n, e.issues));
		}
		!o && i === void 0 ? e.issues.length || t.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [n]
		}) : e.value === void 0 ? (o || i === "defaulted" && !s) && (t.value[n] = void 0) : t.value[n] = e.value;
	}
}
var Ur = [];
function Wr(e) {
	let t = Object.keys(e.shape), n = Object.getOwnPropertySymbols(e.shape), r = n.length ? n : Ur, i = r.length ? [...t, ...r] : t;
	for (let t of i) if (!e.shape?.[t]?._zod?.traits?.has("$ZodType")) throw Error(`Invalid element at key "${String(t)}": expected a Zod schema`);
	let a = Oe(e.shape);
	return {
		...e,
		allKeys: i,
		symbolKeys: r,
		keySet: new Set(t),
		numKeys: t.length,
		optionalKeys: new Set(a)
	};
}
function Gr(e, t, n, r, i, a, o) {
	let s = [], c = i.keySet, l = i.catchall._zod, u = l.def.type, d = l.optin, f = l.optout, p = 0;
	for (let i in t) {
		if (o && n.issues.length !== p) {
			if (Be(n, p)) break;
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
		a instanceof Promise ? e.push(a.then((e) => Hr(e, n, i, t, d, f))) : Hr(a, n, i, t, d, f);
	}
	return s.length && n.issues.push({
		code: "unrecognized_keys",
		keys: s,
		input: t,
		inst: a,
		continue: !0
	}), e.length ? Promise.all(e).then(() => n) : n;
}
var Kr = /*@__PURE__*/ T("$ZodObject", (e, t) => {
	D.init(e, t);
	let n = Object.getOwnPropertyDescriptor(t, "shape"), r = n?.get ? n.get.raw : t.shape ?? {};
	if (r) {
		let e = () => {
			let n = { ...r };
			return Object.defineProperty(t, "shape", { value: n }), e.raw = n, n;
		};
		e.raw = r, Object.defineProperty(t, "shape", { get: e });
	}
	let i = oe(() => Wr(t));
	w(e, "propValues", (e) => {
		let t = e.def.shape, n = {};
		for (let e in t) {
			let r = t[e]._zod;
			if (r.values) {
				Object.prototype.hasOwnProperty.call(n, e) || ue(n, e, /* @__PURE__ */ new Set());
				for (let t of r.values) n[e].add(t);
				r.optin !== void 0 && n[e].add(void 0);
			}
		}
		return n;
	});
	let a = be, o = t.catchall, s, c = gt.memoizer;
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
				if (Be(t, f)) break;
				f = t.issues.length;
			}
			if (e === "__proto__") continue;
			let i = u[e], a = i._zod.optin, o = i._zod.optout, s = i._zod.run({
				value: r[e],
				issues: []
			}, n);
			s instanceof Promise ? l.push(s.then((n) => Hr(n, t, e, r, a, o))) : Hr(s, t, e, r, a, o);
		}
		return o ? Gr(l, r, t, n, i.value, e, d === !0) : l.length ? Promise.all(l).then(() => t) : t;
	};
}), qr = /*@__PURE__*/ T("$ZodObjectJIT", (e, t) => {
	Kr.init(e, t);
	let n = e._zod.parse, r = oe(() => Wr(t)), i = gt.memoizer, a = (t) => {
		let n = r.value, a = n.symbolKeys, o = new Un(["payload", "ctx"], {
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
			let n = l[e], r = typeof e == "symbol" ? `syms[${a.indexOf(e)}]` : _e(e), i = `${r} in input`, u = t[e], d = u?._zod?.optin, f = d !== void 0, p = u?._zod?.optout === "optional";
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
	}, o, s = be, c = !gt.jitless, l = c && xe.value, u = t.catchall, d;
	e._zod.parse = (i, f) => {
		d ??= r.value;
		let p = i.value;
		return s(p) ? c && l && f?.async === !1 && f.jitless !== !0 ? (o ||= a(t.shape), i = o(i, f), u ? Gr([], p, i, f, d, e, f?.abortEarly === !0) : i) : n(i, f) : (i.issues.push({
			expected: "object",
			code: "invalid_type",
			input: p,
			inst: e
		}), i);
	};
});
function Jr(e, t, n, r) {
	for (let n of e) if (n.issues.length === 0) return t.value = n.value, t;
	let i = e.filter((e) => !Be(e));
	return i.length === 1 ? (t.value = i[0].value, i[0]) : (t.issues.push({
		code: "invalid_union",
		input: t.value,
		inst: n,
		errors: e.map((e) => e.issues.map((e) => Ke(e, r, _t())))
	}), t);
}
var Yr = /*@__PURE__*/ T("$ZodUnion", (e, t) => {
	D.init(e, t), w(e, "optin", (e) => e.def.options.some((e) => e._zod.optin === "defaulted") ? "defaulted" : e.def.options.some((e) => e._zod.optin !== void 0) ? "optional" : void 0), w(e, "optout", (e) => e.def.options.some((e) => e._zod.optout === "optional") ? "optional" : void 0), w(e, "values", (e) => {
		if (e.def.options.every((e) => e._zod.values)) return new Set(e.def.options.flatMap((e) => Array.from(e._zod.values)));
	}), w(e, "pattern", (e) => {
		if (e.def.options.every((e) => e._zod.pattern)) {
			let t = e.def.options.map((e) => e._zod.pattern);
			return RegExp(`^(${t.map((e) => ce(e.source)).join("|")})$`);
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
		return a ? Promise.all(o).then((t) => Jr(t, r, e, i)) : Jr(o, r, e, i);
	};
});
function Xr(e) {
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
var Zr = /*@__PURE__*/ T("$ZodDiscriminatedUnion", (e, t) => {
	t.inclusive = !1, Yr.init(e, t);
	let n = e._zod.parse;
	w(e, "propValues", (e) => {
		let t = {}, n = 0;
		for (let r of e.def.options) {
			let i = r._zod.propValues;
			if (!i || Object.keys(i).length === 0) throw Error(`Invalid discriminated union option at index "${e.def.options.indexOf(r)}"`);
			i[e.def.discriminator]?.has(void 0) && n++;
			for (let [e, n] of Object.entries(i)) {
				Object.prototype.hasOwnProperty.call(t, e) || ue(t, e, /* @__PURE__ */ new Set());
				for (let r of n) t[e].add(r);
			}
		}
		return !e.def.unionFallback && n > 1 && t[e.def.discriminator]?.delete(void 0), t;
	}), t.options.forEach((e, n) => {
		let r = de(e._zod.def);
		if (r && !Object.prototype.hasOwnProperty.call(r, t.discriminator)) throw Error(`Invalid discriminated union option at index "${n}"`);
	});
	let r = oe(() => Xr(t));
	e._zod.parse = (i, a) => {
		let o = i.value;
		if (!be(o)) return i.issues.push({
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
}), Qr = /*@__PURE__*/ T("$ZodIntersection", (e, t) => {
	D.init(e, t), e._zod.parse = (e, n) => {
		let r = e.value, i = t.left._zod.run({
			value: r,
			issues: []
		}, n), a = t.right._zod.run({
			value: r,
			issues: []
		}, n);
		return i instanceof Promise || a instanceof Promise ? Promise.all([i, a]).then(([t, n]) => ei(e, t, n)) : ei(e, i, a);
	};
});
function $r(e, t) {
	if (e === t || e instanceof Date && t instanceof Date && +e == +t) return {
		valid: !0,
		data: e
	};
	if (Se(e) && Se(t)) {
		let n = Object.keys(t), r = Object.keys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		Object.prototype.hasOwnProperty.call(i, "__proto__") && delete i.__proto__;
		for (let n of r) {
			if (n === "__proto__") continue;
			let r = $r(e[n], t[n]);
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
			let i = e[r], a = t[r], o = $r(i, a);
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
function ei(e, t, n) {
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
	let c = $r(t.value, n.value);
	if (!c.valid) {
		if (Be(e)) return e;
		throw Error(`Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`);
	}
	return e.value = c.data, e;
}
var ti = /*@__PURE__*/ T("$ZodRecord", (e, t) => {
	D.init(e, t);
	let n = gt.memoizer;
	n?.attach(e), e._zod.parse = (r, i) => {
		let a = r.value;
		if (!Se(a)) return r.issues.push({
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
						issues: s.issues.map((e) => Ke(e, i, _t())),
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
					e.issues.length && r.issues.push(...He(n, e.issues)), r.value[l] = e.value;
				})) : (u.issues.length && r.issues.push(...He(n, u.issues)), r.value[l] = u.value);
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
				if (typeof n == "string" && Sn.test(n) && l.issues.length) {
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
						issues: l.issues.map((e) => Ke(e, i, _t())),
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
					e.issues.length && r.issues.push(...He(n, e.issues)), r.value[u] = e.value;
				})) : (d.issues.length && r.issues.push(...He(n, d.issues)), r.value[u] = d.value);
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
}), ni = /*@__PURE__*/ T("$ZodEnum", (e, t) => {
	D.init(e, t);
	let n = ne(t.entries), r = new Set(n);
	e._zod.values = r, w(e, "pattern", (e) => {
		let t = ne(e.def.entries).filter((e) => we.has(typeof e));
		return RegExp(t.length ? `^(${t.map((e) => Te(e.toString())).join("|")})$` : "^[^\\s\\S]$");
	}), e._zod.parse = (t, i) => {
		let a = t.value;
		return r.has(a) || t.issues.push({
			code: "invalid_value",
			values: n,
			input: a,
			inst: e
		}), t;
	};
}), ri = /*@__PURE__*/ T("$ZodLiteral", (e, t) => {
	D.init(e, t);
	let n = new Set(t.values);
	e._zod.values = n, w(e, "pattern", (e) => {
		let t = e.def.values;
		return RegExp(t.length ? `^(${t.map((e) => typeof e == "string" ? Te(e) : e ? Te(e.toString()) : String(e)).join("|")})$` : "^[^\\s\\S]$");
	}), e._zod.parse = (r, i) => {
		let a = r.value;
		return n.has(a) || r.issues.push({
			code: "invalid_value",
			values: t.values,
			input: a,
			inst: e
		}), r;
	};
}), ii = /*@__PURE__*/ T("$ZodTransform", (e, t) => {
	D.init(e, t), e._zod.optin = "optional", gt.memoizer?.guard(e), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new ht(e.constructor.name);
		let i = t.transform(n.value, n);
		if (r.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => (n.value = e, n));
		if (i instanceof Promise) throw new mt();
		return n.value = i, n;
	};
});
function ai(e, t) {
	return e.value = t.issues.length ? void 0 : t.value, e;
}
var oi = /*@__PURE__*/ T("$ZodOptional", (e, t) => {
	D.init(e, t), w(e, "optin", (e) => e.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), e._zod.optout = "optional", w(e, "values", (e) => {
		let t = e.def.innerType._zod.values;
		return t ? /* @__PURE__ */ new Set([...t, void 0]) : void 0;
	}), w(e, "pattern", (e) => {
		let t = e.def.innerType._zod.pattern;
		return t ? RegExp(`^(${ce(t.source)})?$`) : void 0;
	}), e._zod.parse = (e, n) => {
		if (e.value === void 0) {
			if (t.innerType._zod.optin !== "defaulted") return e;
			let r = t.innerType._zod.run({
				value: e.value,
				issues: []
			}, n);
			return r instanceof Promise ? r.then((t) => ai(e, t)) : ai(e, r);
		}
		return t.innerType._zod.run(e, n);
	};
}), si = /*@__PURE__*/ T("$ZodExactOptional", (e, t) => {
	oi.init(e, t), w(e, "values", (e) => e.def.innerType._zod.values), w(e, "pattern", (e) => e.def.innerType._zod.pattern), e._zod.parse = (e, n) => t.innerType._zod.run(e, n);
}), ci = /*@__PURE__*/ T("$ZodNullable", (e, t) => {
	D.init(e, t), w(e, "optin", (e) => e.def.innerType._zod.optin), w(e, "optout", (e) => e.def.innerType._zod.optout), w(e, "pattern", (e) => {
		let t = e.def.innerType._zod.pattern;
		return t ? RegExp(`^(${ce(t.source)}|null)$`) : void 0;
	}), w(e, "values", (e) => e.def.innerType._zod.values ? /* @__PURE__ */ new Set([...e.def.innerType._zod.values, null]) : void 0), e._zod.parse = (e, n) => e.value === null ? e : t.innerType._zod.run(e, n);
}), li = /*@__PURE__*/ T("$ZodDefault", (e, t) => {
	D.init(e, t), e._zod.optin = "defaulted", w(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		if (e.value === void 0) return e.value = t.defaultValue, e;
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => ui(e, t)) : ui(r, t);
	};
});
function ui(e, t) {
	return e.value === void 0 && (e.value = t.defaultValue), e;
}
var di = /*@__PURE__*/ T("$ZodPrefault", (e, t) => {
	D.init(e, t), e._zod.optin = "defaulted", w(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => (n.direction === "backward" || e.value === void 0 && (e.value = t.defaultValue), t.innerType._zod.run(e, n));
}), fi = /*@__PURE__*/ T("$ZodNonOptional", (e, t) => {
	D.init(e, t), w(e, "values", (e) => {
		let t = e.def.innerType._zod.values;
		return t ? new Set([...t].filter((e) => e !== void 0)) : void 0;
	}), e._zod.parse = (n, r) => {
		let i = t.innerType._zod.run(n, r);
		return i instanceof Promise ? i.then((t) => pi(t, e)) : pi(i, e);
	};
});
function pi(e, t) {
	return !e.issues.length && e.value === void 0 && e.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: e.value,
		inst: t
	}), e;
}
function mi(e, t, n, r) {
	return t.issues.length ? (e.value = n.catchValue({
		...t,
		value: e.value,
		error: { issues: t.issues.map((e) => Ke(e, r, _t())) },
		input: e.value
	}), e) : (e.value = t.value, t.memo && (e.memo = !0), e);
}
var hi = /*@__PURE__*/ T("$ZodCatch", (e, t) => {
	D.init(e, t), w(e, "optin", (e) => e.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), w(e, "optout", (e) => e.def.innerType._zod.optout), w(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run({
			value: e.value,
			issues: []
		}, n);
		return r instanceof Promise ? r.then((r) => mi(e, r, t, n)) : mi(e, r, t, n);
	};
}), gi = /*@__PURE__*/ T("$ZodPipe", (e, t) => {
	D.init(e, t), w(e, "values", (e) => e.def.in._zod.values), w(e, "optin", (e) => e.def.in._zod.optin), w(e, "optout", (e) => e.def.out._zod.optout), w(e, "propValues", (e) => e.def.in._zod.propValues), e._zod.parse = (e, n) => {
		if (n.direction === "backward") {
			let r = t.out._zod.run(e, n);
			return r instanceof Promise ? r.then((e) => _i(e, t.in, n)) : _i(r, t.in, n);
		}
		let r = t.in._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => _i(e, t.out, n)) : _i(r, t.out, n);
	};
});
function _i(e, t, n) {
	return e.issues.some((e) => e.code !== "unrecognized_keys") ? (e.aborted = !0, e) : t._zod.run({
		value: e.value,
		issues: e.issues
	}, n);
}
var vi = /*@__PURE__*/ T("$ZodReadonly", (e, t) => {
	D.init(e, t), w(e, "propValues", (e) => e.def.innerType._zod.propValues), w(e, "values", (e) => e.def.innerType._zod.values), w(e, "optin", (e) => e.def.innerType?._zod?.optin), w(e, "optout", (e) => e.def.innerType?._zod?.optout), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then(yi) : yi(r);
	};
});
function yi(e) {
	return e.memo || (e.value = Object.freeze(e.value)), e;
}
var bi = /*@__PURE__*/ T("$ZodCustom", (e, t) => {
	E.init(e, t), D.init(e, t), e._zod.parse = (e, t) => e, e._zod.check = (n) => {
		let r = n.value, i = t.fn(r);
		if (i instanceof Promise) return i.then((t) => xi(t, n, r, e));
		xi(i, n, r, e);
	};
});
function xi(e, t, n, r) {
	if (!e) {
		let e = {
			code: "custom",
			input: n,
			inst: r,
			path: [...r._zod.def.path ?? []],
			continue: !r._zod.def.abort
		};
		r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Ze(e));
	}
}
// node_modules/zod/v4/core/memoizer.js
var Si = class extends Error {
	constructor() {
		super("Cannot parse a reference cycle that closes through a transform"), this.name = "ZodCyclicError";
	}
}, Ci = "~memo", wi = [];
function Ti(e) {
	return typeof e == "object" && !!e;
}
function Ei(e) {
	return e.map((e) => e.path ? {
		...e,
		path: e.path.slice()
	} : { ...e });
}
var Di = /*@__PURE__*/ new WeakMap(), Oi = 0, ki = 1, Ai = 2;
function ji(e, t, n) {
	let r = Di.get(e);
	if (r !== void 0) return r ? Ai : Oi;
	if (t.has(e)) return Ai;
	t.add(e);
	let i = Oi, a = (e) => {
		if (i !== Ai && e?._zod) {
			let r = ji(e, t, n);
			r > i && (i = r);
		}
	}, o = (e, r) => {
		let i = Oi;
		for (let a of Reflect.ownKeys(e)) {
			let o = Object.getOwnPropertyDescriptor(e, a);
			if (r && !o.enumerable) continue;
			let s = o.get ? ki : o.value?._zod ? ji(o.value, t, n) : Oi;
			s > i && (i = s);
		}
		return i;
	}, s = (e) => {
		e > i && (i = e);
	}, c = e._zod.def;
	switch (c.type) {
		case "object": {
			let e = de(c);
			s(e ? o(e, !0) : ki), a(c.catchall);
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
			s(r ? ji(r, t, !1) : ki);
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
	return t.delete(e), Mi(e, i);
}
function Mi(e, t) {
	return t !== ki && Di.set(e, t === Ai), t;
}
function Ni(e, t) {
	let n = e.buckets.get(t);
	return n || (n = /* @__PURE__ */ new WeakMap(), e.buckets.set(t, n)), n;
}
var Pi, Fi = [], Ii = {
	alloc(e, t, n) {
		let r = Pi;
		if (!r) return n;
		Pi = void 0;
		let i = {
			value: n,
			issues: null
		};
		return r.set(t.value, i), Fi.push(i), n;
	},
	guard(e) {
		var t;
		(t = e._zod).deferred ?? (t.deferred = []), e._zod.deferred.push(() => {
			let t = e._zod.parse, n = (e, n) => {
				if (n.direction !== "backward" && Ri(n, e.value)) throw new Si();
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
					let i = ji(e, /* @__PURE__ */ new Set(), !1);
					if (i === Oi) return e._zod.parse = t, e._zod.run === o && (e._zod.run = t), t(s, c);
					i === Ai || r ? n = !0 : r = !0;
				}
				let l = s.value;
				if (!Ti(l)) return t(s, c);
				let u = c[Ci];
				u || (u = {
					buckets: /* @__PURE__ */ new WeakMap(),
					backEdges: void 0
				}, c[Ci] = u);
				let d;
				i === c ? d = a : (d = Ni(u, e), i = c, a = d);
				let f = d.get(l);
				if (f) return s.value = f.value, f.issues ? f.issues.length && s.issues.push(...Ei(f.issues)) : (s.memo = !0, u.backEdges ?? (u.backEdges = /* @__PURE__ */ new WeakSet()), u.backEdges.add(f.value)), s;
				Pi = d;
				let p = Fi.length, m = t(s, c);
				Pi = void 0;
				let h = Fi.length > p ? Fi.pop() : void 0;
				return m instanceof Promise ? m.then((e) => (h && (h.issues = e.issues.length ? Ei(e.issues) : wi), e)) : (h && (h.issues = m.issues.length ? Ei(m.issues) : wi), m);
			};
			e._zod.parse = o, e._zod.run === t && (e._zod.run = o);
		});
	}
};
function Li() {
	return Ii;
}
function Ri(e, t) {
	let n = e[Ci]?.backEdges;
	return n !== void 0 && Ti(t) && n.has(t);
}
// node_modules/zod/v4/locales/en.js
var zi = () => {
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
			case "invalid_type": return `Invalid input: expected ${i(e.expected)}, received ${i(Xe(e.input), e.input)}`;
			case "invalid_value": return e.values.length === 1 ? `Invalid input: expected ${De(e.values[0])}` : `Invalid option: expected one of ${re(e.values, "|")}`;
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
			case "unrecognized_keys": return `Unrecognized key${e.keys.length > 1 ? "s" : ""}: ${re(e.keys, ", ")}`;
			case "invalid_key": return `Invalid key in ${e.origin}`;
			case "invalid_union": return e.options && Array.isArray(e.options) && e.options.length > 0 ? `Invalid discriminator value. Expected ${e.options.map((e) => `'${e}'`).join(" | ")}` : e.inclusive === !1 ? "Invalid input: more than one option matched" : "Invalid input";
			case "invalid_element": return `Invalid value in ${e.origin}`;
			default: return "Invalid input";
		}
	};
};
function Bi() {
	return { localeError: zi() };
}
// node_modules/zod/v4/core/registries.js
var Vi, Hi = class {
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
function Ui() {
	return new Hi();
}
(Vi = globalThis).__zod_globalRegistry ?? (Vi.__zod_globalRegistry = Ui());
var Wi = globalThis.__zod_globalRegistry;
// node_modules/zod/v4/core/api.js
function Gi(e) {
	return e.checks &&= [...e.checks], e;
}
// @__NO_SIDE_EFFECTS__
function Ki(e, t) {
	return new e(Gi({
		type: "string",
		...C(t)
	}));
}
// @__NO_SIDE_EFFECTS__
function qi(e, t) {
	return new e({
		type: "string",
		format: "email",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ji(e, t) {
	return new e({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Yi(e, t) {
	return new e({
		type: "string",
		format: "uuid",
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
		version: "v4",
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
		version: "v6",
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
		version: "v7",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function $i(e, t) {
	return new e({
		type: "string",
		format: "url",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ea(e, t) {
	return new e({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ta(e, t) {
	return new e({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function na(e, t) {
	return new e({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ra(e, t) {
	return new e({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ia(e, t) {
	return new e({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function aa(e, t) {
	return new e({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function oa(e, t) {
	return new e({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function sa(e, t) {
	return new e({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ca(e, t) {
	return new e({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function la(e, t) {
	return new e({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ua(e, t) {
	return new e({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function da(e, t) {
	return new e({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function fa(e, t) {
	return new e({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function pa(e, t) {
	return new e({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ma(e, t) {
	return new e({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ha(e, t) {
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
function ga(e, t) {
	return new e({
		type: "string",
		format: "date",
		check: "string_format",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function _a(e, t) {
	return new e({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function va(e, t) {
	return new e({
		type: "string",
		format: "duration",
		check: "string_format",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ya(e, t) {
	return new e(Gi({
		type: "number",
		checks: [],
		...C(t)
	}));
}
// @__NO_SIDE_EFFECTS__
function ba(e, t) {
	return new e({
		type: "number",
		check: "number_format",
		abort: !1,
		format: "safeint",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function xa(e, t) {
	return new e({
		type: "boolean",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Sa(e) {
	return new e({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function Ca(e, t) {
	return new e({
		type: "never",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function wa(e, t) {
	return new On({
		check: "less_than",
		...C(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function Ta(e, t) {
	return new On({
		check: "less_than",
		...C(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function Ea(e, t) {
	return new kn({
		check: "greater_than",
		...C(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function Da(e, t) {
	return new kn({
		check: "greater_than",
		...C(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function Oa(e, t) {
	return new An({
		check: "multiple_of",
		...C(t),
		value: e
	});
}
// @__NO_SIDE_EFFECTS__
function ka(e, t) {
	return new Mn({
		check: "max_length",
		...C(t),
		maximum: e
	});
}
// @__NO_SIDE_EFFECTS__
function Aa(e, t) {
	return new Nn({
		check: "min_length",
		...C(t),
		minimum: e
	});
}
// @__NO_SIDE_EFFECTS__
function ja(e, t) {
	return new Pn({
		check: "length_equals",
		...C(t),
		length: e
	});
}
// @__NO_SIDE_EFFECTS__
function Ma(e, t) {
	return new In({
		check: "string_format",
		format: "regex",
		...C(t),
		pattern: e
	});
}
// @__NO_SIDE_EFFECTS__
function Na(e) {
	return new Ln({
		check: "string_format",
		format: "lowercase",
		...C(e)
	});
}
// @__NO_SIDE_EFFECTS__
function Pa(e) {
	return new Rn({
		check: "string_format",
		format: "uppercase",
		...C(e)
	});
}
// @__NO_SIDE_EFFECTS__
function Fa(e, t) {
	return new zn({
		check: "string_format",
		format: "includes",
		...C(t),
		includes: e
	});
}
// @__NO_SIDE_EFFECTS__
function Ia(e, t) {
	return new Bn({
		check: "string_format",
		format: "starts_with",
		...C(t),
		prefix: e
	});
}
// @__NO_SIDE_EFFECTS__
function La(e, t) {
	return new Vn({
		check: "string_format",
		format: "ends_with",
		...C(t),
		suffix: e
	});
}
// @__NO_SIDE_EFFECTS__
function Ra(e) {
	return new Hn({
		check: "overwrite",
		tx: e
	});
}
// @__NO_SIDE_EFFECTS__
function za(e) {
	return /* @__PURE__ */ Ra((t) => t.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function Ba() {
	return /* @__PURE__ */ Ra((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function Va() {
	return /* @__PURE__ */ Ra((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function Ha() {
	return /* @__PURE__ */ Ra((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function Ua() {
	return /* @__PURE__ */ Ra((e) => ve(e));
}
// @__NO_SIDE_EFFECTS__
function Wa(e, t, n) {
	return new e({
		type: "array",
		element: t,
		...C(n)
	});
}
// @__NO_SIDE_EFFECTS__
function Ga(e, t, n) {
	let r = C(n);
	return r.abort ??= !0, new e({
		type: "custom",
		check: "custom",
		fn: t,
		...r
	});
}
// @__NO_SIDE_EFFECTS__
function Ka(e, t, n) {
	return new e({
		type: "custom",
		check: "custom",
		fn: t,
		...C(n)
	});
}
// @__NO_SIDE_EFFECTS__
function qa(e, t) {
	let n = /* @__PURE__ */ Ja((t) => (t.addIssue = (e) => {
		if (typeof e == "string") t.issues.push(Ze(e, t.value, n._zod.def));
		else {
			let r = e;
			r.fatal && (r.continue = !1), r.code ??= "custom", "input" in r || (r.input = t.value), r.inst ??= n, r.continue ??= !n._zod.def.abort, t.issues.push(Ze(r));
		}
	}, e(t.value, t)), t);
	return n;
}
// @__NO_SIDE_EFFECTS__
function Ja(e, t) {
	let n = new E({
		check: "custom",
		...C(t)
	});
	return n._zod.check = e, n;
}
// node_modules/zod/v4/core/to-json-schema.js
function Ya(e, ...t) {
	for (let n of t) for (let t of Reflect.ownKeys(n)) Object.prototype.propertyIsEnumerable.call(n, t) && ue(e, t, n[t]);
	return e;
}
function Xa(e) {
	let t = e?.target ?? "draft-2020-12";
	return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
		processors: e.processors ?? {},
		metadataRegistry: e?.metadata ?? Wi,
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
function Za(e, t, n, r, i) {
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
	return c && Ya(o.schema, c), t.io === "input" && A(e) && (delete o.schema.examples, delete o.schema.default), t.io === "input" && "_prefault" in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)), delete o.schema._prefault, t.seen.get(e).schema;
}
function Qa(e) {
	return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
function $a(e, t) {
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
				ref: `${i("__shared")}#/${r}/${Qa(a)}`
			};
		}
		let i = `#/${r}/`;
		if (t[1] === n && !t[1].schema.id) return { ref: "#" };
		let a = t[1].schema.id ?? `__schema${e.counter++}`;
		return {
			defId: a,
			ref: i + Qa(a)
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
function eo(e) {
	let t = e.anyOf;
	if (!Array.isArray(t) || t.length === 0 || e.type !== void 0) return;
	let n = [];
	for (let e of t) {
		if (!e || typeof e != "object") return;
		eo(e);
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
var to = /* @__PURE__ */ new Set([
	"type",
	"properties",
	"required",
	"additionalProperties"
]), no = ["oneOf", "anyOf"];
function ro(e) {
	let t = e.additionalProperties;
	return t === void 0 || t === !1 || typeof t != "object" || !t ? null : Object.keys(t).length ? t : null;
}
function io(e) {
	let t = [];
	for (let n of e) {
		if (typeof n != "object" || n.type !== "object") return null;
		for (let e in n) if (!to.has(e)) return null;
		t.push(n);
	}
	let n = {}, r = /* @__PURE__ */ new Set();
	for (let e of t) {
		for (let r in e.properties) {
			if (Object.prototype.hasOwnProperty.call(n, r)) continue;
			let e = [];
			for (let n of t) {
				let t = n.properties?.[r] ?? ro(n);
				t != null && (e.some((e) => JSON.stringify(e) === JSON.stringify(t)) || e.push(t));
			}
			ue(n, r, e.length === 1 ? e[0] : io(e) ?? { allOf: e });
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
			let t = ro(n);
			t && !e.some((e) => JSON.stringify(e) === JSON.stringify(t)) && e.push(t);
		}
		e.length === 1 ? i.additionalProperties = e[0] : e.length > 1 && (i.additionalProperties = { allOf: e });
	}
	return i;
}
function ao(e) {
	let t = e.allOf;
	if (!Array.isArray(t) || t.length < 2) return;
	for (let t of to) if (t in e) return;
	let n = t.filter((e) => no.some((t) => Array.isArray(e[t]))), r = null;
	if (!n.length) r = io(t);
	else {
		let e = n[0], i = no.find((t) => Array.isArray(e[t]));
		if (Object.keys(e).length !== 1) return;
		let a = t.filter((t) => t !== e), o = e[i].map((e) => io([...a, e]));
		if (o.some((e) => !e)) return;
		r = { [i]: o };
	}
	r && (delete e.allOf, Ya(e, r));
}
function oo(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	let r = (t) => {
		let n = e.seen.get(t);
		if (n.ref === null) return;
		let i = n.def ?? n.schema, a = { ...i }, o = n.ref;
		if (n.ref = null, o) {
			r(o);
			let n = e.seen.get(o), s = n.schema;
			if (s.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (i.allOf = i.allOf ?? [], i.allOf.push(s)) : Ya(i, s), Ya(i, a), t._zod.parent === o) for (let e in i) e !== "$ref" && e !== "allOf" && (e in a || delete i[e]);
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
		if (e.target !== "openapi-3.0") for (let t of e.seen.entries()) eo(t[1].def ?? t[1].schema);
		for (let t of e.deferred) t();
		if (e.intersections.length) {
			let t = /* @__PURE__ */ new Map();
			for (let n of e.seen.values()) for (let e of [n.schema, n.def]) {
				let n = e?.allOf;
				if (!Array.isArray(n)) continue;
				let r = t.get(n);
				r ? r.push(e) : t.set(n, [e]);
			}
			for (let n of e.intersections) for (let e of t.get(n) ?? []) ao(e);
		}
	}
	let i = {};
	if (e.target === "draft-2020-12" ? i.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? i.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? i.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
		let n = e.external.registry.get(t)?.id;
		if (!n) throw Error("Schema is missing an `id` property");
		i.$id = e.external.uri(n);
	}
	Ya(i, n.defId ? n.schema : n.def ?? n.schema);
	let a = e.metadataRegistry.get(t)?.id;
	a !== void 0 && i.id === a && delete i.id;
	let o = e.external?.defs ?? {};
	if (!e.external || e.sharedEmitDoneFor !== e.external) for (let t of e.seen.entries()) {
		let e = t[1];
		e.def && e.defId && (e.def.id === e.defId && delete e.def.id, ue(o, e.defId, e.def));
	}
	e.external && (e.sharedEmitDoneFor = e.external), e.external || Object.keys(o).length > 0 && (e.target === "draft-2020-12" ? i.$defs = o : i.definitions = o);
	try {
		let n = JSON.parse(JSON.stringify(i));
		return Object.defineProperty(n, "~standard", {
			value: {
				...t["~standard"],
				jsonSchema: {
					input: co(t, "input", e.processors),
					output: co(t, "output", e.processors)
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
var so = (e, t = {}) => (n) => {
	let r = Xa({
		...n,
		processors: t
	});
	return k(e, r), $a(r, e), oo(r, e);
}, co = (e, t, n = {}) => (r) => {
	let { libraryOptions: i, target: a } = r ?? {}, o = Xa({
		...i ?? {},
		target: a,
		io: t,
		processors: n
	});
	return k(e, o), $a(o, e), oo(o, e);
}, lo = (e, t, n) => {
	(e[t] === void 0 || n > e[t]) && (e[t] = n);
}, uo = (e, t, n) => {
	(e[t] === void 0 || n < e[t]) && (e[t] = n);
}, fo = (e, t) => {
	lo(e, "minimum", t), uo(e, "maximum", t);
}, po = (e, t) => {
	e.multipleOf ??= [], e.multipleOf.includes(t) || e.multipleOf.push(t);
}, mo = (e, t) => {
	e.patterns ??= /* @__PURE__ */ new Set(), e.patterns.add(t);
}, ho = (e, t) => {
	e.mime = e.mime ? e.mime.filter((e) => t.includes(e)) : [...t];
}, go = (e, t) => {
	e.format = t, t.includes("int") && (e.isInt = !0);
}, _o = (e, t) => lo(e, "minimum", t.minimum), vo = (e, t) => uo(e, "maximum", t.maximum), yo = (e) => (t, n) => {
	go(t, n.format);
	let [r, i] = e[n.format];
	lo(t, "minimum", r), uo(t, "maximum", i);
}, bo = {
	greater_than: (e, t) => lo(e, t.inclusive ? "minimum" : "exclusiveMinimum", t.value),
	less_than: (e, t) => uo(e, t.inclusive ? "maximum" : "exclusiveMaximum", t.value),
	multiple_of: (e, t) => po(e, t.value),
	number_format: yo(ke),
	bigint_format: yo(Ae),
	min_length: _o,
	max_length: vo,
	length_equals: (e, t) => fo(e, t.length),
	min_size: _o,
	max_size: vo,
	size_equals: (e, t) => fo(e, t.size),
	string_format: (e, t) => {
		go(e, t.format), t.pattern && mo(e, t.pattern), (t.format === "base64" || t.format === "base64url") && (e.contentEncoding = t.format), (t.local || t.precision === -1) && (e.laxFormat = !0);
	},
	mime_type: (e, t) => ho(e, t.mime)
};
function xo(e) {
	let t = {}, n = e._zod.def, r = e._zod.traits.has("$ZodCheck") ? [e, ...n.checks ?? []] : n.checks ?? [];
	for (let e of r) bo[e._zod.def.check]?.(t, e._zod.def);
	let i = e._zod.bag;
	i.minimum !== void 0 && lo(t, "minimum", i.minimum), i.exclusiveMinimum !== void 0 && lo(t, "exclusiveMinimum", i.exclusiveMinimum), i.maximum !== void 0 && uo(t, "maximum", i.maximum), i.exclusiveMaximum !== void 0 && uo(t, "exclusiveMaximum", i.exclusiveMaximum), i.multipleOf !== void 0 && po(t, i.multipleOf), i.format !== void 0 && (t.format ??= i.format, i.format.includes("int") && (t.isInt = !0)), i.mime && ho(t, i.mime);
	for (let e of i.patterns ?? []) mo(t, e);
	return t;
}
var So = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
}, Co = /* @__PURE__ */ new Map([[Tr, un], [Dr, dn]]), wo = (e) => Co.get(e) ?? e, To = (e, t, n, r) => {
	let i = n;
	i.type = "string";
	let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l, laxFormat: u } = xo(e);
	if (typeof a == "number" && (i.minLength = a), typeof o == "number" && (i.maxLength = o), s && (i.format = So[s] ?? s, i.format === "" && delete i.format, (s === "time" || u) && delete i.format), l && (i.contentEncoding = l), c && c.size > 0) {
		let e = [...c].map(wo);
		e.length === 1 ? i.pattern = e[0].source : e.length > 1 && (i.allOf = [...e.map((e) => ({
			...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: e.source
		}))]);
	}
}, Eo = (e, t, n, r) => {
	let i = n, { minimum: a, maximum: o, multipleOf: s, exclusiveMaximum: c, exclusiveMinimum: l, isInt: u } = xo(e);
	i.type = u ? "integer" : "number";
	let d = typeof l == "number" && l >= (a ?? -Infinity), f = typeof c == "number" && c <= (o ?? Infinity), p = t.target === "draft-04" || t.target === "openapi-3.0";
	if (d ? p ? (i.minimum = l, i.exclusiveMinimum = !0) : i.exclusiveMinimum = l : typeof a == "number" && (i.minimum = a), f ? p ? (i.maximum = c, i.exclusiveMaximum = !0) : i.exclusiveMaximum = c : typeof o == "number" && (i.maximum = o), s) {
		let n = /* @__PURE__ */ new Set();
		for (let a of s) Number.isFinite(a) && a !== 0 ? n.add(Math.abs(a)) : Za(e, t, i, r, `A multipleOf divisor of ${a} cannot be represented in JSON Schema`);
		let [a, ...o] = n;
		a !== void 0 && (i.multipleOf = a), o.length && (i.allOf = [...i.allOf ?? [], ...o.map((e) => ({ multipleOf: e }))]);
	}
}, Do = (e, t, n, r) => {
	n.type = "boolean";
}, Oo = (e, t, n, r) => {
	n.not = {};
}, ko = (e, t, n, r) => {
	let i = e._zod.def, a = ne(i.entries);
	a.length === 0 ? n.not = {} : (a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), n.enum = a);
}, Ao = (e, t, n, r) => {
	let i = e._zod.def;
	if (i.values.length === 0) {
		n.not = {};
		return;
	}
	let a = [];
	for (let o of i.values) if (o === void 0) {
		if (Za(e, t, n, r, "Literal `undefined` cannot be represented in JSON Schema")) return;
	} else if (typeof o == "bigint") {
		if (Za(e, t, n, r, "BigInt literals cannot be represented in JSON Schema")) return;
		a.push(Number(o));
	} else a.push(o);
	if (a.length !== 0) {
		if (a.length === 1) {
			let e = a[0];
			n.type = e === null ? "null" : typeof e, t.target === "draft-04" || t.target === "openapi-3.0" ? n.enum = [e] : n.const = e;
		} else a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), a.every((e) => typeof e == "boolean") && (n.type = "boolean"), a.every((e) => e === null) && (n.type = "null"), n.enum = a;
	}
}, jo = (e, t, n, r) => {
	Za(e, t, n, r, "Custom types cannot be represented in JSON Schema");
}, Mo = (e, t, n, r) => {
	Za(e, t, n, r, "Transforms cannot be represented in JSON Schema");
}, No = (e, t, n, r) => {
	let i = n, a = e._zod.def, { minimum: o, maximum: s } = xo(e);
	typeof o == "number" && (i.minItems = o), typeof s == "number" && (i.maxItems = s), i.type = "array", i.items = k(a.element, t, {
		...r,
		path: [...r.path, "items"]
	});
};
function Po(e) {
	let t = e._zod.def;
	return t.type === "pipe" && t.in._zod.traits.has("$ZodTransform") ? Po(t.out) : t.type === "catch" ? Po(t.innerType) : e._zod.optin;
}
var Fo = (e, t, n, r) => {
	let i = n, a = e._zod.def, o = a.shape;
	if (Object.getOwnPropertySymbols(o).length && Za(e, t, i, r, "Symbol keys cannot be represented in JSON Schema")) return;
	i.type = "object", i.properties = {};
	for (let e in o) ue(i.properties, e, k(o[e], t, {
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
		(t.io === "input" ? Po(n) === void 0 : n._zod.optout === void 0) && s.push(e);
	}
	s.length > 0 && (i.required = s), a.catchall?._zod.def.type === "never" ? i.additionalProperties = !1 : a.catchall ? a.catchall && (i.additionalProperties = k(a.catchall, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	})) : t.io === "output" && (i.additionalProperties = !1);
}, Io = (e, t, n, r) => {
	let i = e._zod.def, a = i.inclusive === !1, o = i.options.map((e, n) => k(e, t, {
		...r,
		path: [
			...r.path,
			a ? "oneOf" : "anyOf",
			n
		]
	}));
	a ? n.oneOf = o : n.anyOf = o;
}, Lo = (e, t, n, r) => {
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
function Ro(e, t, n) {
	if (t.$ref) {
		if (n.has(t)) return t;
		n.add(t);
		let r = e.get(t)?.def;
		if (!r) return t;
		let i = Ro(e, r, n);
		return i === r ? t : i;
	}
	for (let r of ["anyOf", "oneOf"]) {
		let i = t[r];
		if (!Array.isArray(i)) continue;
		let a = i.map((t) => Ro(e, t, n));
		a.some((e, t) => e !== i[t]) && (t = {
			...t,
			[r]: a
		});
	}
	let r = Array.isArray(t.type) ? t.type : [t.type], i = !r.includes("string") && r.some((e) => e === "number" || e === "integer"), a = t.enum ?? (t.const === void 0 ? void 0 : [t.const]);
	if (!i && !a?.some((e) => typeof e == "number")) return t;
	let { minimum: o, maximum: s, exclusiveMinimum: c, exclusiveMaximum: l, multipleOf: u, format: d, id: f, ...p } = t;
	return p.enum ? p.enum = p.enum.map((e) => typeof e == "number" ? String(e) : e) : typeof p.const == "number" && (p.const = String(p.const)), i && (p.type = "string", a || (p.pattern = (r.includes("number") ? Sn : xn).source)), p;
}
var zo = /* @__PURE__ */ new WeakMap();
function Bo(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.seen.values()) n.def && !t.has(n.schema) && t.set(n.schema, n);
	let n = /* @__PURE__ */ new Map();
	for (let r of zo.get(e) ?? []) {
		let i = e.seen.get(r), a = (i?.def ?? i?.schema)?.propertyNames;
		if (!a || a === !0 || n.has(a)) continue;
		let o = Ro(t, a, /* @__PURE__ */ new Set());
		o !== a && n.set(a, o);
	}
	if (n.size) for (let t of e.seen.values()) for (let e of [t.schema, t.def]) {
		let t = e && n.get(e.propertyNames);
		t && (e.propertyNames = t);
	}
}
var Vo = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object";
	let o = a.keyType, s = xo(o).patterns;
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
		for (let t of s) ue(i.patternProperties, wo(t).source, e);
	} else {
		if (t.target === "draft-07" || t.target === "draft-2020-12") {
			i.propertyNames = k(a.keyType, t, {
				...r,
				path: [...r.path, "propertyNames"]
			});
			let n = zo.get(t);
			n || (n = [], zo.set(t, n), t.deferred.push(() => Bo(t))), n.push(e);
		}
		i.additionalProperties = k(a.valueType, t, {
			...r,
			path: [...r.path, "additionalProperties"]
		});
	}
	let c = o._zod.values, l = t.io === "input" && Po(a.valueType) !== void 0;
	if (c && !a.partial && !l) {
		let e = [...c].filter((e) => typeof e == "string" || typeof e == "number");
		e.length > 0 && (i.required = e.map(String));
	}
}, Ho = (e, t, n, r) => {
	let i = e._zod.def, a = k(i.innerType, t, r), o = t.seen.get(e);
	t.target === "openapi-3.0" ? (o.ref = i.innerType, n.nullable = !0) : n.anyOf = [a, { type: "null" }];
}, Uo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Wo = Symbol();
function Go(e, t, n, r, i) {
	let a = !1, o = JSON.stringify(e, (e, t) => typeof t == "bigint" ? (a = !0, null) : t);
	return a ? (Za(t, n, r, i, "BigInt defaults cannot be represented in JSON Schema"), Wo) : JSON.parse(o);
}
var Ko = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o = Go(i.defaultValue, e, t, n, r);
	o !== Wo && (n.default = o);
}, qo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	if (a.ref = i.innerType, t.io !== "input") return;
	let o = Go(i.defaultValue, e, t, n, r);
	o !== Wo && (n._prefault = o);
}, Jo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o;
	try {
		o = i.catchValue(void 0);
	} catch {
		Za(e, t, n, r, "Dynamic catch values are not supported in JSON Schema");
		return;
	}
	n.default = o;
}, Yo = (e, t, n, r) => {
	let i = e._zod.def, a = i.in._zod.traits.has("$ZodTransform"), o = t.io === "input" ? a ? i.out : i.in : i.out;
	k(o, t, r);
	let s = t.seen.get(e);
	s.ref = o;
}, Xo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.readOnly = !0;
}, Zo = (e, t, n, r) => {
	let i = e._zod.def;
	k(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Qo = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function $o(e, t, n) {
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
	Ct.init(e, t), e.name = "ZodError";
	let n = Object.getPrototypeOf(e);
	Qo.has(n) || (Qo.add(n), $o(n, "format", (e) => (t) => Et(e, t)), $o(n, "flatten", (e) => (t) => Tt(e, t)), $o(n, "addIssue", (e) => (t) => {
		e.issues.push(t), e.message = JSON.stringify(e.issues, ie, 2);
	}), $o(n, "addIssues", (e) => (t) => {
		e.issues.push(...t), e.message = JSON.stringify(e.issues, ie, 2);
	}), Object.defineProperty(n, "isEmpty", {
		configurable: !0,
		enumerable: !1,
		get() {
			return this.issues.length === 0;
		}
	}));
}, void 0, { Parent: Error }), es = /* @__PURE__ */ Ot(j), ts = /* @__PURE__ */ kt(j), ns = /* @__PURE__ */ At(j), rs = /* @__PURE__ */ Mt(j), is = /* @__PURE__ */ Rt(j), as = /* @__PURE__ */ zt(j), os = /* @__PURE__ */ Bt(j), ss = /* @__PURE__ */ Vt(j), cs = /* @__PURE__ */ Ht(j), ls = /* @__PURE__ */ Ut(j), us = /* @__PURE__ */ Wt(j), ds = /* @__PURE__ */ Gt(j);
// node_modules/zod/v4/classic/schemas.js
function fs() {
	gt.localeError || _t(Bi());
}
function ps() {
	gt.memoizer || _t({ memoizer: Li() });
}
var M = /*@__PURE__*/ T("ZodType", (e, t) => (fs(), D.init(e, t), e.def = t, e.type = t.type, e), {
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
		return Ee(this, e, t);
	},
	brand() {
		return this;
	},
	register(e, t) {
		return e.add(this, t), this;
	},
	refine(e, t) {
		return this.check(Ac(e, t));
	},
	superRefine(e, t) {
		return this.check(jc(e, t));
	},
	overwrite(e) {
		return this.check(/* @__PURE__ */ Ra(e));
	},
	optional() {
		return dc(this);
	},
	exactOptional() {
		return pc(this);
	},
	nullable() {
		return hc(this);
	},
	nullish() {
		return dc(hc(this));
	},
	nonoptional(e) {
		return xc(this, e);
	},
	array() {
		return F(this);
	},
	or(e) {
		return $s([this, e]);
	},
	and(e) {
		return rc(this, e);
	},
	transform(e) {
		return Tc(this, lc(e));
	},
	default(e) {
		return _c(this, e);
	},
	prefault(e) {
		return yc(this, e);
	},
	catch(e) {
		return Cc(this, e);
	},
	pipe(e) {
		return Tc(this, e);
	},
	readonly() {
		return Dc(this);
	},
	describe(e) {
		let t = this.clone();
		return Wi.add(t, { description: e }), t;
	},
	meta(...e) {
		if (e.length === 0) return Wi.get(this);
		let t = this.clone();
		return Wi.add(t, e[0]), t;
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
		return et(this, "~standard", {
			...qn(this),
			jsonSchema: {
				input: co(this, "input"),
				output: co(this, "output")
			}
		});
	},
	set "~standard"(e) {
		$e(this, "~standard", e);
	},
	parse: function e(t, n) {
		return es(this, t, n, { callee: e });
	},
	parseAsync: async function e(t, n) {
		return await ts(this, t, n, { callee: e });
	},
	safeParse(e, t) {
		return ns(this, e, t);
	},
	async safeParseAsync(e, t) {
		return rs(this, e, t);
	},
	get spa() {
		return this?.safeParseAsync;
	},
	set spa(e) {
		$e(this, "spa", e);
	},
	validate(e, t) {
		return Ft(this, e, t);
	},
	validateAsync(e, t) {
		return Lt(this, e, t);
	},
	encode: function e(t, n) {
		return is(this, t, n, { callee: e });
	},
	decode: function e(t, n) {
		return as(this, t, n, { callee: e });
	},
	encodeAsync: async function e(t, n) {
		return await os(this, t, n, { callee: e });
	},
	decodeAsync: async function e(t, n) {
		return await ss(this, t, n, { callee: e });
	},
	safeEncode(e, t) {
		return cs(this, e, t);
	},
	safeDecode(e, t) {
		return ls(this, e, t);
	},
	async safeEncodeAsync(e, t) {
		return us(this, e, t);
	},
	async safeDecodeAsync(e, t) {
		return ds(this, e, t);
	},
	toJSONSchema(e) {
		return so(this, {})(e);
	},
	get description() {
		return Wi.get(this)?.description;
	},
	get _def() {
		return this._zod.def;
	}
}), ms = /*@__PURE__*/ T("_ZodString", (e, t) => {
	Jn.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => To(e, t, n, r);
}, /*@__PURE__*/ tt({
	format: (e) => xo(e).format ?? null,
	minLength: (e) => xo(e).minimum ?? null,
	maxLength: (e) => xo(e).maximum ?? null
}, {
	regex(...e) {
		return this.check(/* @__PURE__ */ Ma(...e));
	},
	includes(...e) {
		return this.check(/* @__PURE__ */ Fa(...e));
	},
	startsWith(...e) {
		return this.check(/* @__PURE__ */ Ia(...e));
	},
	endsWith(...e) {
		return this.check(/* @__PURE__ */ La(...e));
	},
	min(...e) {
		return this.check(/* @__PURE__ */ Aa(...e));
	},
	max(...e) {
		return this.check(/* @__PURE__ */ ka(...e));
	},
	length(...e) {
		return this.check(/* @__PURE__ */ ja(...e));
	},
	nonempty(...e) {
		return this.check(/* @__PURE__ */ Aa(1, ...e));
	},
	lowercase(e) {
		return this.check(/* @__PURE__ */ Na(e));
	},
	uppercase(e) {
		return this.check(/* @__PURE__ */ Pa(e));
	},
	trim() {
		return this.check(/* @__PURE__ */ Ba());
	},
	normalize(...e) {
		return this.check(/* @__PURE__ */ za(...e));
	},
	toLowerCase() {
		return this.check(/* @__PURE__ */ Va());
	},
	toUpperCase() {
		return this.check(/* @__PURE__ */ Ha());
	},
	slugify() {
		return this.check(/* @__PURE__ */ Ua());
	}
})), hs = /*@__PURE__*/ T("ZodString", (e, t) => {
	Jn.init(e, t), ms.init(e, t);
}, {
	email(e) {
		return this.check(/* @__PURE__ */ qi(bs, e));
	},
	url(e) {
		return this.check(/* @__PURE__ */ $i(ws, e));
	},
	jwt(e) {
		return this.check(/* @__PURE__ */ ma(zs, e));
	},
	emoji(e) {
		return this.check(/* @__PURE__ */ ea(Ts, e));
	},
	guid(e) {
		return this.check(/* @__PURE__ */ Ji(xs, e));
	},
	uuid(e) {
		return this.check(/* @__PURE__ */ Yi(Ss, e));
	},
	uuidv4(e) {
		return this.check(/* @__PURE__ */ Xi(Ss, e));
	},
	uuidv6(e) {
		return this.check(/* @__PURE__ */ Zi(Ss, e));
	},
	uuidv7(e) {
		return this.check(/* @__PURE__ */ Qi(Ss, e));
	},
	nanoid(e) {
		return this.check(/* @__PURE__ */ ta(Es, e));
	},
	cuid(e) {
		return this.check(/* @__PURE__ */ na(Ds, e));
	},
	cuid2(e) {
		return this.check(/* @__PURE__ */ ra(Os, e));
	},
	ulid(e) {
		return this.check(/* @__PURE__ */ ia(ks, e));
	},
	base64(e) {
		return this.check(/* @__PURE__ */ da(Is, e));
	},
	base64url(e) {
		return this.check(/* @__PURE__ */ fa(Ls, e));
	},
	xid(e) {
		return this.check(/* @__PURE__ */ aa(As, e));
	},
	ksuid(e) {
		return this.check(/* @__PURE__ */ oa(js, e));
	},
	ipv4(e) {
		return this.check(/* @__PURE__ */ sa(Ms, e));
	},
	ipv6(e) {
		return this.check(/* @__PURE__ */ ca(Ns, e));
	},
	cidrv4(e) {
		return this.check(/* @__PURE__ */ la(Ps, e));
	},
	cidrv6(e) {
		return this.check(/* @__PURE__ */ ua(Fs, e));
	},
	e164(e) {
		return this.check(/* @__PURE__ */ pa(Rs, e));
	},
	datetime(e) {
		return this.check(/* @__PURE__ */ ha(gs, e));
	},
	date(e) {
		return this.check(/* @__PURE__ */ ga(_s, e));
	},
	time(e) {
		return this.check(/* @__PURE__ */ _a(vs, e));
	},
	duration(e) {
		return this.check(/* @__PURE__ */ va(ys, e));
	}
});
function N(e) {
	return /* @__PURE__ */ Ki(hs, e);
}
var P = /*@__PURE__*/ T("ZodStringFormat", (e, t) => {
	O.init(e, t), ms.init(e, t);
}), gs = /*@__PURE__*/ T("ZodISODateTime", (e, t) => {
	pr.init(e, t), P.init(e, t);
}), _s = /*@__PURE__*/ T("ZodISODate", (e, t) => {
	mr.init(e, t), P.init(e, t);
}), vs = /*@__PURE__*/ T("ZodISOTime", (e, t) => {
	hr.init(e, t), P.init(e, t);
}), ys = /*@__PURE__*/ T("ZodISODuration", (e, t) => {
	gr.init(e, t), P.init(e, t);
}), bs = /*@__PURE__*/ T("ZodEmail", (e, t) => {
	Zn.init(e, t), P.init(e, t);
}), xs = /*@__PURE__*/ T("ZodGUID", (e, t) => {
	Yn.init(e, t), P.init(e, t);
}), Ss = /*@__PURE__*/ T("ZodUUID", (e, t) => {
	Xn.init(e, t), P.init(e, t);
});
function Cs(e) {
	return /* @__PURE__ */ Yi(Ss, e);
}
var ws = /*@__PURE__*/ T("ZodURL", (e, t) => {
	ar.init(e, t), P.init(e, t);
}), Ts = /*@__PURE__*/ T("ZodEmoji", (e, t) => {
	or.init(e, t), P.init(e, t);
}), Es = /*@__PURE__*/ T("ZodNanoID", (e, t) => {
	sr.init(e, t), P.init(e, t);
}), Ds = /*@__PURE__*/ T("ZodCUID", (e, t) => {
	cr.init(e, t), P.init(e, t);
}), Os = /*@__PURE__*/ T("ZodCUID2", (e, t) => {
	lr.init(e, t), P.init(e, t);
}), ks = /*@__PURE__*/ T("ZodULID", (e, t) => {
	ur.init(e, t), P.init(e, t);
}), As = /*@__PURE__*/ T("ZodXID", (e, t) => {
	dr.init(e, t), P.init(e, t);
}), js = /*@__PURE__*/ T("ZodKSUID", (e, t) => {
	fr.init(e, t), P.init(e, t);
}), Ms = /*@__PURE__*/ T("ZodIPv4", (e, t) => {
	_r.init(e, t), P.init(e, t);
}), Ns = /*@__PURE__*/ T("ZodIPv6", (e, t) => {
	br.init(e, t), P.init(e, t);
}), Ps = /*@__PURE__*/ T("ZodCIDRv4", (e, t) => {
	xr.init(e, t), P.init(e, t);
}), Fs = /*@__PURE__*/ T("ZodCIDRv6", (e, t) => {
	Cr.init(e, t), P.init(e, t);
}), Is = /*@__PURE__*/ T("ZodBase64", (e, t) => {
	Er.init(e, t), P.init(e, t);
}), Ls = /*@__PURE__*/ T("ZodBase64URL", (e, t) => {
	kr.init(e, t), P.init(e, t);
}), Rs = /*@__PURE__*/ T("ZodE164", (e, t) => {
	Ar.init(e, t), P.init(e, t);
}), zs = /*@__PURE__*/ T("ZodJWT", (e, t) => {
	Mr.init(e, t), P.init(e, t);
}), Bs = /*@__PURE__*/ T("ZodNumber", (e, t) => {
	Nr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Eo(e, t, n, r), e.isFinite = !0;
}, /*@__PURE__*/ tt({
	minValue: (e) => {
		let { minimum: t, exclusiveMinimum: n } = xo(e);
		return Math.max(t ?? -Infinity, n ?? -Infinity);
	},
	maxValue: (e) => {
		let { maximum: t, exclusiveMaximum: n } = xo(e);
		return Math.min(t ?? Infinity, n ?? Infinity);
	},
	isInt: (e) => {
		let { isInt: t, multipleOf: n } = xo(e);
		return !!t || !!n?.some(Number.isSafeInteger);
	},
	format: (e) => xo(e).format ?? null
}, {
	gt(e, t) {
		return this.check(/* @__PURE__ */ Ea(e, t));
	},
	gte(e, t) {
		return this.check(/* @__PURE__ */ Da(e, t));
	},
	min(e, t) {
		return this.check(/* @__PURE__ */ Da(e, t));
	},
	lt(e, t) {
		return this.check(/* @__PURE__ */ wa(e, t));
	},
	lte(e, t) {
		return this.check(/* @__PURE__ */ Ta(e, t));
	},
	max(e, t) {
		return this.check(/* @__PURE__ */ Ta(e, t));
	},
	int(e) {
		return this.check(Us(e));
	},
	safe(e) {
		return this.check(Us(e));
	},
	positive(e) {
		return this.check(/* @__PURE__ */ Ea(0, e));
	},
	nonnegative(e) {
		return this.check(/* @__PURE__ */ Da(0, e));
	},
	negative(e) {
		return this.check(/* @__PURE__ */ wa(0, e));
	},
	nonpositive(e) {
		return this.check(/* @__PURE__ */ Ta(0, e));
	},
	multipleOf(e, t) {
		return this.check(/* @__PURE__ */ Oa(e, t));
	},
	step(e, t) {
		return this.check(/* @__PURE__ */ Oa(e, t));
	},
	finite() {
		return this;
	}
}));
function Vs(e) {
	return /* @__PURE__ */ ya(Bs, e);
}
var Hs = /*@__PURE__*/ T("ZodNumberFormat", (e, t) => {
	Pr.init(e, t), Bs.init(e, t);
});
function Us(e) {
	return /* @__PURE__ */ ba(Hs, e);
}
var Ws = /*@__PURE__*/ T("ZodBoolean", (e, t) => {
	Fr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Do(e, t, n, r);
});
function Gs(e) {
	return /* @__PURE__ */ xa(Ws, e);
}
var Ks = /*@__PURE__*/ T("ZodUnknown", (e, t) => {
	Ir.init(e, t), M.init(e, t), e._zod.processJSONSchema = (e, t, n) => void 0;
});
function qs() {
	return /* @__PURE__ */ Sa(Ks);
}
var Js = /*@__PURE__*/ T("ZodNever", (e, t) => {
	Lr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Oo(e, t, n, r);
});
function Ys(e) {
	return /* @__PURE__ */ Ca(Js, e);
}
var Xs = /*@__PURE__*/ T("ZodArray", (e, t) => {
	ps(), Vr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => No(e, t, n, r), e.element = t.element;
}, {
	min(e, t) {
		return this.check(/* @__PURE__ */ Aa(e, t));
	},
	nonempty(e) {
		return this.check(/* @__PURE__ */ Aa(1, e));
	},
	max(e, t) {
		return this.check(/* @__PURE__ */ ka(e, t));
	},
	length(e, t) {
		return this.check(/* @__PURE__ */ ja(e, t));
	},
	unwrap() {
		return this.element;
	}
});
function F(e, t) {
	return /* @__PURE__ */ Wa(Xs, e, t);
}
var Zs = /*@__PURE__*/ T("ZodObject", (e, t) => {
	ps(), qr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Fo(e, t, n, r), st(e, "shape", (e) => e._zod.def.shape, !1);
}, {
	keyof() {
		return L(Object.keys(this._zod.def.shape));
	},
	catchall(e) {
		return this.clone(S(this._zod.def, { catchall: e }));
	},
	passthrough() {
		return this.clone(S(this._zod.def, { catchall: qs() }));
	},
	loose() {
		return this.clone(S(this._zod.def, { catchall: qs() }));
	},
	strict() {
		return this.clone(S(this._zod.def, { catchall: Ys() }));
	},
	strip() {
		return this.clone(S(this._zod.def, { catchall: void 0 }));
	},
	extend(e) {
		return Pe(this, e);
	},
	safeExtend(e) {
		return Ie(this, e);
	},
	merge(e) {
		return Le(this, e);
	},
	pick(e) {
		return je(this, e);
	},
	omit(e) {
		return Ne(this, e);
	},
	partial(...e) {
		return Re(uc, this, e[0]);
	},
	exactPartial(...e) {
		return Re(fc, this, e[0], "exactPartial");
	},
	required(...e) {
		return ze(bc, this, e[0]);
	}
});
function I(e, t) {
	return new Zs({
		type: "object",
		shape: e,
		catchall: Ys(),
		...C(t)
	});
}
var Qs = /*@__PURE__*/ T("ZodUnion", (e, t) => {
	Yr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Io(e, t, n, r), e.options = t.options;
});
function $s(e, t) {
	return new Qs({
		type: "union",
		options: e,
		...C(t)
	});
}
var ec = /*@__PURE__*/ T("ZodDiscriminatedUnion", (e, t) => {
	Qs.init(e, t), Zr.init(e, t);
});
function tc(e, t, n) {
	return new ec({
		type: "union",
		options: t,
		discriminator: e,
		...C(n)
	});
}
var nc = /*@__PURE__*/ T("ZodIntersection", (e, t) => {
	Qr.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Lo(e, t, n, r);
});
function rc(e, t) {
	return new nc({
		type: "intersection",
		left: e,
		right: t
	});
}
var ic = /*@__PURE__*/ T("ZodRecord", (e, t) => {
	ps(), ti.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Vo(e, t, n, r), e.keyType = t.keyType, e.valueType = t.valueType;
});
function ac(e, t, n) {
	return !t || !t._zod ? new ic({
		type: "record",
		keyType: N(),
		valueType: e,
		...C(t)
	}) : new ic({
		type: "record",
		keyType: e,
		valueType: t,
		...C(n)
	});
}
var oc = /*@__PURE__*/ T("ZodEnum", (e, t) => {
	ni.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => ko(e, t, n, r), e.enum = t.entries, e.options = [...e._zod.values];
	let n = new Set(Object.keys(t.entries));
	e.extract = (e, r) => {
		let i = {};
		for (let r of e) if (n.has(r)) i[r] = t.entries[r];
		else throw Error(`Key ${r} not found in enum`);
		return new oc({
			...t,
			checks: [],
			...C(r),
			entries: i
		});
	}, e.exclude = (e, r) => {
		let i = { ...t.entries };
		for (let t of e) if (n.has(t)) delete i[t];
		else throw Error(`Key ${t} not found in enum`);
		return new oc({
			...t,
			checks: [],
			...C(r),
			entries: i
		});
	};
});
function L(e, t) {
	return new oc({
		type: "enum",
		entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
		...C(t)
	});
}
var sc = /*@__PURE__*/ T("ZodLiteral", (e, t) => {
	ri.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ao(e, t, n, r), e.values = new Set(t.values), Object.defineProperty(e, "value", { get() {
		if (t.values.length > 1) throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return t.values[0];
	} });
});
function R(e, t) {
	return new sc({
		type: "literal",
		values: Array.isArray(e) ? e : [e],
		...C(t)
	});
}
var cc = /*@__PURE__*/ T("ZodTransform", (e, t) => {
	ps(), ii.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Mo(e, t, n, r), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new ht(e.constructor.name);
		n.addIssue = (r) => {
			if (typeof r == "string") n.issues.push(Ze(r, n.value, t));
			else {
				let t = r;
				t.fatal && (t.continue = !1), t.code ??= "custom", "input" in t || (t.input = n.value), t.inst ??= e, n.issues.push(Ze(t));
			}
		};
		let i = t.transform(n.value, n);
		return i instanceof Promise ? i.then((e) => (n.value = e, n)) : (n.value = i, n);
	};
});
function lc(e) {
	return new cc({
		type: "transform",
		transform: e
	});
}
var uc = /*@__PURE__*/ T("ZodOptional", (e, t) => {
	oi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Zo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function dc(e) {
	return new uc({
		type: "optional",
		innerType: e
	});
}
var fc = /*@__PURE__*/ T("ZodExactOptional", (e, t) => {
	si.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Zo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function pc(e) {
	return new fc({
		type: "optional",
		innerType: e
	});
}
var mc = /*@__PURE__*/ T("ZodNullable", (e, t) => {
	ci.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ho(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function hc(e) {
	return new mc({
		type: "nullable",
		innerType: e
	});
}
var gc = /*@__PURE__*/ T("ZodDefault", (e, t) => {
	li.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ko(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function _c(e, t) {
	return new gc({
		type: "default",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : Ce(t);
		}
	});
}
var vc = /*@__PURE__*/ T("ZodPrefault", (e, t) => {
	di.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => qo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function yc(e, t) {
	return new vc({
		type: "prefault",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : Ce(t);
		}
	});
}
var bc = /*@__PURE__*/ T("ZodNonOptional", (e, t) => {
	fi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Uo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function xc(e, t) {
	return new bc({
		type: "nonoptional",
		innerType: e,
		...C(t)
	});
}
var Sc = /*@__PURE__*/ T("ZodCatch", (e, t) => {
	hi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Jo(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function Cc(e, t) {
	return new Sc({
		type: "catch",
		innerType: e,
		catchValue: typeof t == "function" ? t : lt(t)
	});
}
var wc = /*@__PURE__*/ T("ZodPipe", (e, t) => {
	gi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Yo(e, t, n, r), e.in = t.in, e.out = t.out;
});
function Tc(e, t) {
	return new wc({
		type: "pipe",
		in: e,
		out: t
	});
}
var Ec = /*@__PURE__*/ T("ZodReadonly", (e, t) => {
	vi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => Xo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Dc(e) {
	return new Ec({
		type: "readonly",
		innerType: e
	});
}
var Oc = /*@__PURE__*/ T("ZodCustom", (e, t) => {
	bi.init(e, t), M.init(e, t), e._zod.processJSONSchema = (t, n, r) => jo(e, t, n, r);
});
function kc(e, t) {
	return /* @__PURE__ */ Ga(Oc, e ?? (() => !0), t);
}
function Ac(e, t = {}) {
	return /* @__PURE__ */ Ka(Oc, e, t);
}
function jc(e, t) {
	return /* @__PURE__ */ qa(e, t);
}
// node_modules/zod/v4/classic/iso.js
function z(e) {
	return /* @__PURE__ */ ha(gs, e);
}
// node_modules/yaml/browser/dist/nodes/identity.js
var Mc = Symbol.for("yaml.alias"), Nc = Symbol.for("yaml.document"), Pc = Symbol.for("yaml.map"), Fc = Symbol.for("yaml.pair"), Ic = Symbol.for("yaml.scalar"), Lc = Symbol.for("yaml.seq"), Rc = Symbol.for("yaml.node.type"), zc = (e) => !!e && typeof e == "object" && e[Rc] === Mc, Bc = (e) => !!e && typeof e == "object" && e[Rc] === Nc, Vc = (e) => !!e && typeof e == "object" && e[Rc] === Pc, B = (e) => !!e && typeof e == "object" && e[Rc] === Fc, V = (e) => !!e && typeof e == "object" && e[Rc] === Ic, Hc = (e) => !!e && typeof e == "object" && e[Rc] === Lc;
function H(e) {
	if (e && typeof e == "object") switch (e[Rc]) {
		case Pc:
		case Lc: return !0;
	}
	return !1;
}
function U(e) {
	if (e && typeof e == "object") switch (e[Rc]) {
		case Mc:
		case Pc:
		case Ic:
		case Lc: return !0;
	}
	return !1;
}
var Uc = (e) => (V(e) || H(e)) && !!e.anchor, Wc = Symbol("break visit"), Gc = Symbol("skip children"), Kc = Symbol("remove node");
function qc(e, t) {
	let n = Yc(t);
	Bc(e) ? Jc(null, e.contents, n, Object.freeze([e])) === Kc && (e.contents = null) : Jc(null, e, n, Object.freeze([]));
}
qc.BREAK = Wc, qc.SKIP = Gc, qc.REMOVE = Kc;
function Jc(e, t, n, r) {
	let i = Xc(e, t, n, r);
	if (U(i) || B(i)) return Zc(e, r, i), Jc(e, i, n, r);
	if (typeof i != "symbol") {
		if (H(t)) {
			r = Object.freeze(r.concat(t));
			for (let e = 0; e < t.items.length; ++e) {
				let i = Jc(e, t.items[e], n, r);
				if (typeof i == "number") e = i - 1;
				else if (i === Wc) return Wc;
				else i === Kc && (t.items.splice(e, 1), --e);
			}
		} else if (B(t)) {
			r = Object.freeze(r.concat(t));
			let e = Jc("key", t.key, n, r);
			if (e === Wc) return Wc;
			e === Kc && (t.key = null);
			let i = Jc("value", t.value, n, r);
			if (i === Wc) return Wc;
			i === Kc && (t.value = null);
		}
	}
	return i;
}
function Yc(e) {
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
function Xc(e, t, n, r) {
	if (typeof n == "function") return n(e, t, r);
	if (Vc(t)) return n.Map?.(e, t, r);
	if (Hc(t)) return n.Seq?.(e, t, r);
	if (B(t)) return n.Pair?.(e, t, r);
	if (V(t)) return n.Scalar?.(e, t, r);
	if (zc(t)) return n.Alias?.(e, t, r);
}
function Zc(e, t, n) {
	let r = t[t.length - 1];
	if (H(r)) r.items[e] = n;
	else if (B(r)) e === "key" ? r.key = n : r.value = n;
	else if (Bc(r)) r.contents = n;
	else {
		let e = zc(r) ? "alias" : "scalar";
		throw Error(`Cannot replace node with ${e} parent`);
	}
}
// node_modules/yaml/browser/dist/doc/directives.js
var Qc = {
	"!": "%21",
	",": "%2C",
	"[": "%5B",
	"]": "%5D",
	"{": "%7B",
	"}": "%7D"
}, $c = (e) => e.replace(/[!,[\]{}]/g, (e) => Qc[e]), el = class e {
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
		for (let [t, n] of Object.entries(this.tags)) if (e.startsWith(n)) return t + $c(e.substring(n.length));
		return e[0] === "!" ? e : `!<${e}>`;
	}
	toString(e) {
		let t = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [], n = Object.entries(this.tags), r;
		if (e && n.length > 0 && U(e.contents)) {
			let t = {};
			qc(e.contents, (e, n) => {
				U(n) && n.tag && (t[n.tag] = !0);
			}), r = Object.keys(t);
		} else r = [];
		for (let [i, a] of n) i === "!!" && a === "tag:yaml.org,2002:" || e && !r.some((e) => e.startsWith(a)) || t.push(`%TAG ${i} ${a}`);
		return t.join("\n");
	}
};
el.defaultYaml = {
	explicit: !1,
	version: "1.2"
}, el.defaultTags = { "!!": "tag:yaml.org,2002:" };
// node_modules/yaml/browser/dist/doc/anchors.js
function tl(e) {
	if (/[\x00-\x19\s,[\]{}]/.test(e)) {
		let t = `Anchor must not contain whitespace or control characters: ${JSON.stringify(e)}`;
		throw Error(t);
	}
	return !0;
}
function nl(e) {
	let t = /* @__PURE__ */ new Set();
	return qc(e, { Value(e, n) {
		n.anchor && t.add(n.anchor);
	} }), t;
}
function rl(e, t) {
	for (let n = 1;; ++n) {
		let r = `${e}${n}`;
		if (!t.has(r)) return r;
	}
}
function il(e, t) {
	let n = [], r = /* @__PURE__ */ new Map(), i = null;
	return {
		onAnchor: (r) => {
			n.push(r), i ??= nl(e);
			let a = rl(t, i);
			return i.add(a), a;
		},
		setAnchors: () => {
			for (let e of n) {
				let t = r.get(e);
				if (typeof t == "object" && t.anchor && (V(t.node) || H(t.node))) t.node.anchor = t.anchor;
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
function al(e, t, n, r) {
	if (r && typeof r == "object") {
		if (Array.isArray(r)) for (let t = 0, n = r.length; t < n; ++t) {
			let n = r[t], i = al(e, r, String(t), n);
			i === void 0 ? delete r[t] : i !== n && (r[t] = i);
		}
		else if (r instanceof Map) for (let t of Array.from(r.keys())) {
			let n = r.get(t), i = al(e, r, t, n);
			i === void 0 ? r.delete(t) : i !== n && r.set(t, i);
		}
		else if (r instanceof Set) for (let t of Array.from(r)) {
			let n = al(e, r, t, t);
			n === void 0 ? r.delete(t) : n !== t && (r.delete(t), r.add(n));
		}
		else for (let [t, n] of Object.entries(r)) {
			let i = al(e, r, t, n);
			i === void 0 ? delete r[t] : i !== n && (r[t] = i);
		}
	}
	return e.call(t, n, r);
}
// node_modules/yaml/browser/dist/nodes/toJS.js
function ol(e, t, n) {
	if (Array.isArray(e)) return e.map((e, t) => ol(e, String(t), n));
	if (e && typeof e.toJSON == "function") {
		if (!n || !Uc(e)) return e.toJSON(t, n);
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
var sl = class {
	constructor(e) {
		Object.defineProperty(this, Rc, { value: e });
	}
	clone() {
		let e = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
		return this.range && (e.range = this.range.slice()), e;
	}
	toJS(e, { mapAsMap: t, maxAliasCount: n, onAnchor: r, reviver: i } = {}) {
		if (!Bc(e)) throw TypeError("A document argument is required");
		let a = {
			anchors: /* @__PURE__ */ new Map(),
			doc: e,
			keep: !0,
			mapAsMap: t === !0,
			mapKeyWarned: !1,
			maxAliasCount: typeof n == "number" ? n : 100
		}, o = ol(this, "", a);
		if (typeof r == "function") for (let { count: e, res: t } of a.anchors.values()) r(t, e);
		return typeof i == "function" ? al(i, { "": o }, "", o) : o;
	}
}, cl = class extends sl {
	constructor(e) {
		super(Mc), this.source = e, Object.defineProperty(this, "tag", { set() {
			throw Error("Alias nodes cannot have tags");
		} });
	}
	resolve(e, t) {
		if (t?.maxAliasCount === 0) throw ReferenceError("Alias resolution is disabled");
		let n;
		t?.aliasResolveCache ? n = t.aliasResolveCache : (n = [], qc(e, { Node: (e, t) => {
			(zc(t) || Uc(t)) && n.push(t);
		} }), t && (t.aliasResolveCache = n));
		let r;
		for (let e of n) {
			if (e === this) break;
			e.anchor === this.source && (r = e);
		}
		if (r && t) {
			let { anchors: e, doc: n, maxAliasCount: i } = t, a = e.get(r);
			/* istanbul ignore if */
			if (a ||= (ol(r, null, t), e.get(r)), a?.res === void 0) throw ReferenceError("This should not happen: Alias anchor was not resolved?");
			if (i >= 0 && (a.count += 1, a.aliasCount === 0 && (a.aliasCount = ll(n, r, e)), a.count * a.aliasCount > i)) throw ReferenceError("Excessive alias count indicates a resource exhaustion attack");
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
			if (tl(this.source), e.options.verifyAliasOrder && !e.anchors.has(this.source)) {
				let e = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
				throw Error(e);
			}
			if (e.implicitKey) return `${r} `;
		}
		return r;
	}
};
function ll(e, t, n) {
	if (zc(t)) {
		let r = t.resolve(e), i = n && r && n.get(r);
		return i ? i.count * i.aliasCount : 0;
	}
	if (H(t)) {
		let r = 0;
		for (let i of t.items) {
			let t = ll(e, i, n);
			t > r && (r = t);
		}
		return r;
	}
	if (B(t)) {
		let r = ll(e, t.key, n), i = ll(e, t.value, n);
		return Math.max(r, i);
	}
	return 1;
}
// node_modules/yaml/browser/dist/nodes/Scalar.js
var ul = (e) => !e || typeof e != "function" && typeof e != "object", W = class extends sl {
	constructor(e) {
		super(Ic), this.value = e;
	}
	toJSON(e, t) {
		return t?.keep ? this.value : ol(this.value, e, t);
	}
	toString() {
		return String(this.value);
	}
};
W.BLOCK_FOLDED = "BLOCK_FOLDED", W.BLOCK_LITERAL = "BLOCK_LITERAL", W.PLAIN = "PLAIN", W.QUOTE_DOUBLE = "QUOTE_DOUBLE", W.QUOTE_SINGLE = "QUOTE_SINGLE";
// node_modules/yaml/browser/dist/doc/createNode.js
var dl = "tag:yaml.org,2002:";
function fl(e, t, n) {
	if (t) {
		let e = n.filter((e) => e.tag === t), r = e.find((e) => !e.format) ?? e[0];
		if (!r) throw Error(`Tag ${t} not found`);
		return r;
	}
	return n.find((t) => t.identify?.(e) && !t.format);
}
function pl(e, t, n) {
	if (Bc(e) && (e = e.contents), U(e)) return e;
	if (B(e)) {
		let t = n.schema[Pc].createNode?.(n.schema, null, n);
		return t.items.push(e), t;
	}
	(e instanceof String || e instanceof Number || e instanceof Boolean || typeof BigInt < "u" && e instanceof BigInt) && (e = e.valueOf());
	let { aliasDuplicateObjects: r, onAnchor: i, onTagObj: a, schema: o, sourceObjects: s } = n, c;
	if (r && e && typeof e == "object") {
		if (c = s.get(e), c) return c.anchor ?? (c.anchor = i(e)), new cl(c.anchor);
		c = {
			anchor: null,
			node: null
		}, s.set(e, c);
	}
	t?.startsWith("!!") && (t = dl + t.slice(2));
	let l = fl(e, t, o.tags);
	if (!l) {
		if (e && typeof e.toJSON == "function" && (e = e.toJSON()), !e || typeof e != "object") {
			let t = new W(e);
			return c && (c.node = t), t;
		}
		l = e instanceof Map ? o[Pc] : Symbol.iterator in Object(e) ? o[Lc] : o[Pc];
	}
	a && (a(l), delete n.onTagObj);
	let u = l?.createNode ? l.createNode(n.schema, e, n) : typeof l?.nodeClass?.from == "function" ? l.nodeClass.from(n.schema, e, n) : new W(e);
	return t ? u.tag = t : l.default || (u.tag = l.tag), c && (c.node = u), u;
}
// node_modules/yaml/browser/dist/nodes/Collection.js
function ml(e, t, n) {
	let r = n;
	for (let e = t.length - 1; e >= 0; --e) {
		let n = t[e];
		if (typeof n == "number" && Number.isInteger(n) && n >= 0) {
			let e = [];
			e[n] = r, r = e;
		} else r = /* @__PURE__ */ new Map([[n, r]]);
	}
	return pl(r, void 0, {
		aliasDuplicateObjects: !1,
		keepUndefined: !1,
		onAnchor: () => {
			throw Error("This should not happen, please report a bug.");
		},
		schema: e,
		sourceObjects: /* @__PURE__ */ new Map()
	});
}
var hl = (e) => e == null || typeof e == "object" && !!e[Symbol.iterator]().next().done, gl = class extends sl {
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
		return e && (t.schema = e), t.items = t.items.map((t) => U(t) || B(t) ? t.clone(e) : t), this.range && (t.range = this.range.slice()), t;
	}
	addIn(e, t) {
		if (hl(e)) this.add(t);
		else {
			let [n, ...r] = e, i = this.get(n, !0);
			if (H(i)) i.addIn(r, t);
			else if (i === void 0 && this.schema) this.set(n, ml(this.schema, r, t));
			else throw Error(`Expected YAML collection at ${n}. Remaining path: ${r}`);
		}
	}
	deleteIn(e) {
		let [t, ...n] = e;
		if (n.length === 0) return this.delete(t);
		let r = this.get(t, !0);
		if (H(r)) return r.deleteIn(n);
		throw Error(`Expected YAML collection at ${t}. Remaining path: ${n}`);
	}
	getIn(e, t) {
		let [n, ...r] = e, i = this.get(n, !0);
		return r.length === 0 ? !t && V(i) ? i.value : i : H(i) ? i.getIn(r, t) : void 0;
	}
	hasAllNullValues(e) {
		return this.items.every((t) => {
			if (!B(t)) return !1;
			let n = t.value;
			return n == null || e && V(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
		});
	}
	hasIn(e) {
		let [t, ...n] = e;
		if (n.length === 0) return this.has(t);
		let r = this.get(t, !0);
		return H(r) ? r.hasIn(n) : !1;
	}
	setIn(e, t) {
		let [n, ...r] = e;
		if (r.length === 0) this.set(n, t);
		else {
			let e = this.get(n, !0);
			if (H(e)) e.setIn(r, t);
			else if (e === void 0 && this.schema) this.set(n, ml(this.schema, r, t));
			else throw Error(`Expected YAML collection at ${n}. Remaining path: ${r}`);
		}
	}
}, _l = (e) => e.replace(/^(?!$)(?: $)?/gm, "#");
function vl(e, t) {
	return /^\n+$/.test(e) ? e.substring(1) : t ? e.replace(/^(?! *$)/gm, t) : e;
}
var yl = (e, t, n) => e.endsWith("\n") ? vl(n, t) : n.includes("\n") ? "\n" + vl(n, t) : (e.endsWith(" ") ? "" : " ") + n, bl = "flow", xl = "block", Sl = "quoted";
function Cl(e, t, n = "flow", { indentAtStart: r, lineWidth: i = 80, minContentWidth: a = 20, onFold: o, onOverflow: s } = {}) {
	if (!i || i < 0) return e;
	i < a && (a = 0);
	let c = Math.max(1 + a, 1 + i - t.length);
	if (e.length <= c) return e;
	let l = [], u = {}, d = i - t.length;
	typeof r == "number" && (r > i - Math.max(2, a) ? l.push(0) : d = i - r);
	let f, p, m = !1, h = -1, g = -1, _ = -1;
	n === "block" && (h = wl(e, h, t.length), h !== -1 && (d = h + c));
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
		if (r === "\n") n === "block" && (h = wl(e, h, t.length)), d = h + t.length + c, f = void 0;
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
function wl(e, t, n) {
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
var Tl = (e, t) => ({
	indentAtStart: t ? e.indent.length : e.indentAtStart,
	lineWidth: e.options.lineWidth,
	minContentWidth: e.options.minContentWidth
}), El = (e) => /^(%|---|\.\.\.)/m.test(e);
function Dl(e, t, n) {
	if (!t || t < 0) return !1;
	let r = t - n, i = e.length;
	if (i <= r) return !1;
	for (let t = 0, n = 0; t < i; ++t) if (e[t] === "\n") {
		if (t - n > r) return !0;
		if (n = t + 1, i - n <= r) return !1;
	}
	return !0;
}
function Ol(e, t) {
	let n = JSON.stringify(e);
	if (t.options.doubleQuotedAsJSON) return n;
	let { implicitKey: r } = t, i = t.options.doubleQuotedMinMultiLineLength, a = t.indent || (El(e) ? "  " : ""), o = "", s = 0;
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
	return o = s ? o + n.slice(s) : n, r ? o : Cl(o, a, Sl, Tl(t, !1));
}
function kl(e, t) {
	if (t.options.singleQuote === !1 || t.implicitKey && e.includes("\n") || /[ \t]\n|\n[ \t]/.test(e)) return Ol(e, t);
	let n = t.indent || (El(e) ? "  " : ""), r = "'" + e.replace(/'/g, "''").replace(/\n+/g, `$&\n${n}`) + "'";
	return t.implicitKey ? r : Cl(r, n, bl, Tl(t, !1));
}
function Al(e, t) {
	let { singleQuote: n } = t.options, r;
	if (n === !1) r = Ol;
	else {
		let t = e.includes("\""), i = e.includes("'");
		r = t && !i ? kl : i && !t ? Ol : n ? kl : Ol;
	}
	return r(e, t);
}
var jl;
try {
	jl = /* @__PURE__ */ RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
} catch {
	jl = /\n+(?!\n|$)/g;
}
function Ml({ comment: e, type: t, value: n }, r, i, a) {
	let { blockQuote: o, commentString: s, lineWidth: c } = r.options;
	if (!o || /\n[\t ]+$/.test(n)) return Al(n, r);
	let l = r.indent || (r.forceBlockIndent || El(n) ? "  " : ""), u = o === "literal" ? !0 : o === "folded" || t === W.BLOCK_FOLDED ? !1 : t === W.BLOCK_LITERAL || !Dl(n, c, l.length);
	if (!n) return u ? "|\n" : ">\n";
	let d, f;
	for (f = n.length; f > 0; --f) {
		let e = n[f - 1];
		if (e !== "\n" && e !== "	" && e !== " ") break;
	}
	let p = n.substring(f), m = p.indexOf("\n");
	m === -1 ? d = "-" : n === p || m !== p.length - 1 ? (d = "+", a && a()) : d = "", p &&= (n = n.slice(0, -p.length), p[p.length - 1] === "\n" && (p = p.slice(0, -1)), p.replace(jl, `$&${l}`));
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
		let e = n.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${l}`), i = !1, a = Tl(r, !0);
		o !== "folded" && t !== W.BLOCK_FOLDED && (a.onOverflow = () => {
			i = !0;
		});
		let s = Cl(`${v}${e}${p}`, l, xl, a);
		if (!i) return `>${y}\n${l}${s}`;
	}
	return n = n.replace(/\n+/g, `$&${l}`), `|${y}\n${l}${v}${n}${p}`;
}
function Nl(e, t, n, r) {
	let { type: i, value: a } = e, { actualString: o, implicitKey: s, indent: c, indentStep: l, inFlow: u } = t;
	if (s && a.includes("\n") || u && /[[\]{},]/.test(a)) return Al(a, t);
	if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(a)) return s || u || !a.includes("\n") ? Al(a, t) : Ml(e, t, n, r);
	if (!s && !u && i !== W.PLAIN && a.includes("\n")) return Ml(e, t, n, r);
	if (El(a)) {
		if (c === "") return t.forceBlockIndent = !0, Ml(e, t, n, r);
		if (s && c === l) return Al(a, t);
	}
	let d = a.replace(/\n+/g, `$&\n${c}`);
	if (o) {
		let e = (e) => e.default && e.tag !== "tag:yaml.org,2002:str" && e.test?.test(d), { compat: n, tags: r } = t.doc.schema;
		if (r.some(e) || n?.some(e)) return Al(a, t);
	}
	return s ? d : Cl(d, c, bl, Tl(t, !1));
}
function Pl(e, t, n, r) {
	let { implicitKey: i, inFlow: a } = t, o = typeof e.value == "string" ? e : Object.assign({}, e, { value: String(e.value) }), { type: s } = e;
	s !== W.QUOTE_DOUBLE && /[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(o.value) && (s = W.QUOTE_DOUBLE);
	let c = (e) => {
		switch (e) {
			case W.BLOCK_FOLDED:
			case W.BLOCK_LITERAL: return i || a ? Al(o.value, t) : Ml(o, t, n, r);
			case W.QUOTE_DOUBLE: return Ol(o.value, t);
			case W.QUOTE_SINGLE: return kl(o.value, t);
			case W.PLAIN: return Nl(o, t, n, r);
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
function Fl(e, t) {
	let n = Object.assign({
		blockQuote: !0,
		commentString: _l,
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
function Il(e, t) {
	if (t.tag) {
		let n = e.filter((e) => e.tag === t.tag);
		if (n.length > 0) return n.find((e) => e.format === t.format) ?? n[0];
	}
	let n, r;
	if (V(t)) {
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
function Ll(e, t, { anchors: n, doc: r }) {
	if (!r.directives) return "";
	let i = [], a = (V(e) || H(e)) && e.anchor;
	a && tl(a) && (n.add(a), i.push(`&${a}`));
	let o = e.tag ?? (t.default ? null : t.tag);
	return o && i.push(r.directives.tagString(o)), i.join(" ");
}
function Rl(e, t, n, r) {
	if (B(e)) return e.toString(t, n, r);
	if (zc(e)) {
		if (t.doc.directives) return e.toString(t);
		if (t.resolvedAliases?.has(e)) throw TypeError("Cannot stringify circular structure without alias nodes");
		t.resolvedAliases ? t.resolvedAliases.add(e) : t.resolvedAliases = /* @__PURE__ */ new Set([e]), e = e.resolve(t.doc);
	}
	let i, a = U(e) ? e : t.doc.createNode(e, { onTagObj: (e) => i = e });
	i ??= Il(t.doc.schema.tags, a);
	let o = Ll(a, i, t);
	o.length > 0 && (t.indentAtStart = (t.indentAtStart ?? 0) + o.length + 1);
	let s = typeof i.stringify == "function" ? i.stringify(a, t, n, r) : V(a) ? Pl(a, t, n, r) : a.toString(t, n, r);
	return o ? V(a) || s[0] === "{" || s[0] === "[" ? `${o} ${s}` : `${o}\n${t.indent}${s}` : s;
}
// node_modules/yaml/browser/dist/stringify/stringifyPair.js
function zl({ key: e, value: t }, n, r, i) {
	let { allNullValues: a, doc: o, indent: s, indentStep: c, options: { commentString: l, indentSeq: u, simpleKeys: d } } = n, f = U(e) && e.comment || null;
	if (d) {
		if (f) throw Error("With simple keys, key nodes cannot have comments");
		if (H(e) || !U(e) && typeof e == "object") throw Error("With simple keys, collection cannot be used as a key value");
	}
	let p = !d && (!e || f && t == null && !n.inFlow || H(e) || (V(e) ? e.type === W.BLOCK_FOLDED || e.type === W.BLOCK_LITERAL : typeof e == "object"));
	n = Object.assign({}, n, {
		allNullValues: !1,
		implicitKey: !p && (d || !a),
		indent: s + c
	});
	let m = !1, h = !1, g = Rl(e, n, () => m = !0, () => h = !0);
	if (!p && !n.inFlow && g.length > 1024) {
		if (d) throw Error("With simple keys, single line scalar must not span more than 1024 characters");
		p = !0;
	}
	if (n.inFlow) {
		if (a || t == null) return m && r && r(), g === "" ? "?" : p ? `? ${g}` : g;
	} else if (a && !d || t == null && p) return g = `? ${g}`, f && !m ? g += yl(g, n.indent, l(f)) : h && i && i(), g;
	m && (f = null), p ? (f && (g += yl(g, n.indent, l(f))), g = `? ${g}\n${s}:`) : (g = `${g}:`, f && (g += yl(g, n.indent, l(f))));
	let _, v, y;
	U(t) ? (_ = !!t.spaceBefore, v = t.commentBefore, y = t.comment) : (_ = !1, v = null, y = null, t && typeof t == "object" && (t = o.createNode(t))), n.implicitKey = !1, !p && !f && V(t) && (n.indentAtStart = g.length + 1), h = !1, !u && c.length >= 2 && !n.inFlow && !p && Hc(t) && !t.flow && !t.tag && !t.anchor && (n.indent = n.indent.substring(2));
	let ee = !1, b = Rl(t, n, () => ee = !0, () => h = !0), x = " ";
	if (f || _ || v) {
		if (x = _ ? "\n" : "", v) {
			let e = l(v);
			x += `\n${vl(e, n.indent)}`;
		}
		b === "" && !n.inFlow ? x === "\n" && y && (x = "\n\n") : x += `\n${n.indent}`;
	} else if (!p && H(t)) {
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
	return g += x + b, n.inFlow ? ee && r && r() : y && !ee ? g += yl(g, n.indent, l(y)) : h && i && i(), g;
}
// node_modules/yaml/browser/dist/log.js
function Bl(e, t) {
	(e === "debug" || e === "warn") && console.warn(t);
}
// node_modules/yaml/browser/dist/schema/yaml-1.1/merge.js
var Vl = "<<", Hl = {
	identify: (e) => e === Vl || typeof e == "symbol" && e.description === Vl,
	default: "key",
	tag: "tag:yaml.org,2002:merge",
	test: /^<<$/,
	resolve: () => Object.assign(new W(Symbol(Vl)), { addToJSMap: Wl }),
	stringify: () => Vl
}, Ul = (e, t) => (Hl.identify(t) || V(t) && (!t.type || t.type === W.PLAIN) && Hl.identify(t.value)) && e?.doc.schema.tags.some((e) => e.tag === Hl.tag && e.default);
function Wl(e, t, n) {
	let r = Kl(e, n);
	if (Hc(r)) for (let n of r.items) Gl(e, t, n);
	else if (Array.isArray(r)) for (let n of r) Gl(e, t, n);
	else Gl(e, t, r);
}
function Gl(e, t, n) {
	let r = Kl(e, n);
	if (!Vc(r)) throw Error("Merge sources must be maps or map aliases");
	let i = r.toJSON(null, e, Map);
	for (let [e, n] of i) t instanceof Map ? t.has(e) || t.set(e, n) : t instanceof Set ? t.add(e) : Object.prototype.hasOwnProperty.call(t, e) || Object.defineProperty(t, e, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
	return t;
}
function Kl(e, t) {
	return e && zc(t) ? t.resolve(e.doc, e) : t;
}
// node_modules/yaml/browser/dist/nodes/addPairToJSMap.js
function ql(e, t, { key: n, value: r }) {
	if (U(n) && n.addToJSMap) n.addToJSMap(e, t, r);
	else if (Ul(e, n)) Wl(e, t, r);
	else {
		let i = ol(n, "", e);
		if (t instanceof Map) t.set(i, ol(r, i, e));
		else if (t instanceof Set) t.add(i);
		else {
			let a = Jl(n, i, e), o = ol(r, a, e);
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
function Jl(e, t, n) {
	if (t === null) return "";
	if (typeof t != "object") return String(t);
	if (U(e) && n?.doc) {
		let t = Fl(n.doc, {});
		t.anchors = /* @__PURE__ */ new Set();
		for (let e of n.anchors.keys()) t.anchors.add(e.anchor);
		t.inFlow = !0, t.inStringifyKey = !0;
		let r = e.toString(t);
		if (!n.mapKeyWarned) {
			let e = JSON.stringify(r);
			e.length > 40 && (e = e.substring(0, 36) + "...\""), Bl(n.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${e}. Set mapAsMap: true to use object keys.`), n.mapKeyWarned = !0;
		}
		return r;
	}
	return JSON.stringify(t);
}
// node_modules/yaml/browser/dist/nodes/Pair.js
function Yl(e, t, n) {
	return new G(pl(e, void 0, n), pl(t, void 0, n));
}
var G = class e {
	constructor(e, t = null) {
		Object.defineProperty(this, Rc, { value: Fc }), this.key = e, this.value = t;
	}
	clone(t) {
		let { key: n, value: r } = this;
		return U(n) && (n = n.clone(t)), U(r) && (r = r.clone(t)), new e(n, r);
	}
	toJSON(e, t) {
		return ql(t, t?.mapAsMap ? /* @__PURE__ */ new Map() : {}, this);
	}
	toString(e, t, n) {
		return e?.doc ? zl(this, e, t, n) : JSON.stringify(this);
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyCollection.js
function Xl(e, t, n) {
	return (t.inFlow ?? e.flow ? Ql : Zl)(e, t, n);
}
function Zl({ comment: e, items: t }, n, { blockItemPrefix: r, flowChars: i, itemIndent: a, onChompKeep: o, onComment: s }) {
	let { indent: c, options: { commentString: l } } = n, u = Object.assign({}, n, {
		indent: a,
		type: null
	}), d = !1, f = [];
	for (let e = 0; e < t.length; ++e) {
		let i = t[e], o = null;
		if (U(i)) !d && i.spaceBefore && f.push(""), $l(n, f, i.commentBefore, d), i.comment && (o = i.comment);
		else if (B(i)) {
			let e = U(i.key) ? i.key : null;
			e && (!d && e.spaceBefore && f.push(""), $l(n, f, e.commentBefore, d));
		}
		d = !1;
		let s = Rl(i, u, () => o = null, () => d = !0);
		o && (s += yl(s, a, l(o))), d && o && (d = !1), f.push(r + s);
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
	return e ? (p += "\n" + vl(l(e), c), s && s()) : d && o && o(), p;
}
function Ql({ items: e }, t, { flowChars: n, itemIndent: r }) {
	let { indent: i, indentStep: a, flowCollectionPadding: o, options: { commentString: s } } = t;
	r += a;
	let c = Object.assign({}, t, {
		indent: r,
		inFlow: !0,
		type: null
	}), l = !1, u = 0, d = [];
	for (let n = 0; n < e.length; ++n) {
		let i = e[n], a = null;
		if (U(i)) i.spaceBefore && d.push(""), $l(t, d, i.commentBefore, !1), i.comment && (a = i.comment);
		else if (B(i)) {
			let e = U(i.key) ? i.key : null;
			e && (e.spaceBefore && d.push(""), $l(t, d, e.commentBefore, !1), e.comment && (l = !0));
			let n = U(i.value) ? i.value : null;
			n ? (n.comment && (a = n.comment), n.commentBefore && (l = !0)) : i.value == null && e?.comment && (a = e.comment);
		}
		a && (l = !0);
		let o = Rl(i, c, () => a = null);
		l ||= d.length > u || o.includes("\n"), n < e.length - 1 ? o += "," : t.options.trailingComma && (t.options.lineWidth > 0 && (l ||= d.reduce((e, t) => e + t.length + 2, 2) + (o.length + 2) > t.options.lineWidth), l && (o += ",")), a && (o += yl(o, r, s(a))), d.push(o), u = d.length;
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
function $l({ indent: e, options: { commentString: t } }, n, r, i) {
	if (r && i && (r = r.replace(/^\n+/, "")), r) {
		let i = vl(t(r), e);
		n.push(i.trimStart());
	}
}
// node_modules/yaml/browser/dist/nodes/YAMLMap.js
function eu(e, t) {
	let n = V(t) ? t.value : t;
	for (let r of e) if (B(r) && (r.key === t || r.key === n || V(r.key) && r.key.value === n)) return r;
}
var K = class extends gl {
	static get tagName() {
		return "tag:yaml.org,2002:map";
	}
	constructor(e) {
		super(Pc, e), this.items = [];
	}
	static from(e, t, n) {
		let { keepUndefined: r, replacer: i } = n, a = new this(e), o = (e, o) => {
			if (typeof i == "function") o = i.call(t, e, o);
			else if (Array.isArray(i) && !i.includes(e)) return;
			(o !== void 0 || r) && a.items.push(Yl(e, o, n));
		};
		if (t instanceof Map) for (let [e, n] of t) o(e, n);
		else if (t && typeof t == "object") for (let e of Object.keys(t)) o(e, t[e]);
		return typeof e.sortMapEntries == "function" && a.items.sort(e.sortMapEntries), a;
	}
	add(e, t) {
		let n;
		n = B(e) ? e : !e || typeof e != "object" || !("key" in e) ? new G(e, e?.value) : new G(e.key, e.value);
		let r = eu(this.items, n.key), i = this.schema?.sortMapEntries;
		if (r) {
			if (!t) throw Error(`Key ${n.key} already set`);
			V(r.value) && ul(n.value) ? r.value.value = n.value : r.value = n.value;
		} else if (i) {
			let e = this.items.findIndex((e) => i(n, e) < 0);
			e === -1 ? this.items.push(n) : this.items.splice(e, 0, n);
		} else this.items.push(n);
	}
	delete(e) {
		let t = eu(this.items, e);
		return t ? this.items.splice(this.items.indexOf(t), 1).length > 0 : !1;
	}
	get(e, t) {
		let n = eu(this.items, e)?.value;
		return (!t && V(n) ? n.value : n) ?? void 0;
	}
	has(e) {
		return !!eu(this.items, e);
	}
	set(e, t) {
		this.add(new G(e, t), !0);
	}
	toJSON(e, t, n) {
		let r = n ? new n() : t?.mapAsMap ? /* @__PURE__ */ new Map() : {};
		t?.onCreate && t.onCreate(r);
		for (let e of this.items) ql(t, r, e);
		return r;
	}
	toString(e, t, n) {
		if (!e) return JSON.stringify(this);
		for (let e of this.items) if (!B(e)) throw Error(`Map items must all be pairs; found ${JSON.stringify(e)} instead`);
		return !e.allNullValues && this.hasAllNullValues(!1) && (e = Object.assign({}, e, { allNullValues: !0 })), Xl(this, e, {
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
}, tu = {
	collection: "map",
	default: !0,
	nodeClass: K,
	tag: "tag:yaml.org,2002:map",
	resolve(e, t) {
		return Vc(e) || t("Expected a mapping for this tag"), e;
	},
	createNode: (e, t, n) => K.from(e, t, n)
}, nu = class extends gl {
	static get tagName() {
		return "tag:yaml.org,2002:seq";
	}
	constructor(e) {
		super(Lc, e), this.items = [];
	}
	add(e) {
		this.items.push(e);
	}
	delete(e) {
		let t = ru(e);
		return typeof t == "number" && this.items.splice(t, 1).length > 0;
	}
	get(e, t) {
		let n = ru(e);
		if (typeof n != "number") return;
		let r = this.items[n];
		return !t && V(r) ? r.value : r;
	}
	has(e) {
		let t = ru(e);
		return typeof t == "number" && t < this.items.length;
	}
	set(e, t) {
		let n = ru(e);
		if (typeof n != "number") throw Error(`Expected a valid index, not ${e}.`);
		let r = this.items[n];
		V(r) && ul(t) ? r.value = t : this.items[n] = t;
	}
	toJSON(e, t) {
		let n = [];
		t?.onCreate && t.onCreate(n);
		let r = 0;
		for (let e of this.items) n.push(ol(e, String(r++), t));
		return n;
	}
	toString(e, t, n) {
		return e ? Xl(this, e, {
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
				i.items.push(pl(a, void 0, n));
			}
		}
		return i;
	}
};
function ru(e) {
	let t = V(e) ? e.value : e;
	return t && typeof t == "string" && (t = Number(t)), typeof t == "number" && Number.isInteger(t) && t >= 0 ? t : null;
}
// node_modules/yaml/browser/dist/schema/common/seq.js
var iu = {
	collection: "seq",
	default: !0,
	nodeClass: nu,
	tag: "tag:yaml.org,2002:seq",
	resolve(e, t) {
		return Hc(e) || t("Expected a sequence for this tag"), e;
	},
	createNode: (e, t, n) => nu.from(e, t, n)
}, au = {
	identify: (e) => typeof e == "string",
	default: !0,
	tag: "tag:yaml.org,2002:str",
	resolve: (e) => e,
	stringify(e, t, n, r) {
		return t = Object.assign({ actualString: !0 }, t), Pl(e, t, n, r);
	}
}, ou = {
	identify: (e) => e == null,
	createNode: () => new W(null),
	default: !0,
	tag: "tag:yaml.org,2002:null",
	test: /^(?:~|[Nn]ull|NULL)?$/,
	resolve: () => new W(null),
	stringify: ({ source: e }, t) => typeof e == "string" && ou.test.test(e) ? e : t.options.nullStr
}, su = {
	identify: (e) => typeof e == "boolean",
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
	resolve: (e) => new W(e[0] === "t" || e[0] === "T"),
	stringify({ source: e, value: t }, n) {
		return e && su.test.test(e) && t === (e[0] === "t" || e[0] === "T") ? e : t ? n.options.trueStr : n.options.falseStr;
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyNumber.js
function cu({ format: e, minFractionDigits: t, tag: n, value: r }) {
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
var lu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
	resolve: (e) => e.slice(-3).toLowerCase() === "nan" ? NaN : e[0] === "-" ? -Infinity : Infinity,
	stringify: cu
}, uu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "EXP",
	test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
	resolve: (e) => parseFloat(e),
	stringify(e) {
		let t = Number(e.value);
		return isFinite(t) ? t.toExponential() : cu(e);
	}
}, du = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
	resolve(e) {
		let t = new W(parseFloat(e)), n = e.indexOf(".");
		return n !== -1 && e[e.length - 1] === "0" && (t.minFractionDigits = e.length - n - 1), t;
	},
	stringify: cu
}, fu = (e) => typeof e == "bigint" || Number.isInteger(e), pu = (e, t, n, { intAsBigInt: r }) => r ? BigInt(e) : parseInt(e.substring(t), n);
function mu(e, t, n) {
	let { value: r } = e;
	return fu(r) && r >= 0 ? n + r.toString(t) : cu(e);
}
var hu = {
	identify: (e) => fu(e) && e >= 0,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "OCT",
	test: /^0o[0-7]+$/,
	resolve: (e, t, n) => pu(e, 2, 8, n),
	stringify: (e) => mu(e, 8, "0o")
}, gu = {
	identify: fu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	test: /^[-+]?[0-9]+$/,
	resolve: (e, t, n) => pu(e, 0, 10, n),
	stringify: cu
}, _u = {
	identify: (e) => fu(e) && e >= 0,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "HEX",
	test: /^0x[0-9a-fA-F]+$/,
	resolve: (e, t, n) => pu(e, 2, 16, n),
	stringify: (e) => mu(e, 16, "0x")
}, vu = [
	tu,
	iu,
	au,
	ou,
	su,
	hu,
	gu,
	_u,
	lu,
	uu,
	du
];
// node_modules/yaml/browser/dist/schema/json/schema.js
function yu(e) {
	return typeof e == "bigint" || Number.isInteger(e);
}
var bu = ({ value: e }) => JSON.stringify(e), xu = [
	{
		identify: (e) => typeof e == "string",
		default: !0,
		tag: "tag:yaml.org,2002:str",
		resolve: (e) => e,
		stringify: bu
	},
	{
		identify: (e) => e == null,
		createNode: () => new W(null),
		default: !0,
		tag: "tag:yaml.org,2002:null",
		test: /^null$/,
		resolve: () => null,
		stringify: bu
	},
	{
		identify: (e) => typeof e == "boolean",
		default: !0,
		tag: "tag:yaml.org,2002:bool",
		test: /^true$|^false$/,
		resolve: (e) => e === "true",
		stringify: bu
	},
	{
		identify: yu,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		test: /^-?(?:0|[1-9][0-9]*)$/,
		resolve: (e, t, { intAsBigInt: n }) => n ? BigInt(e) : parseInt(e, 10),
		stringify: ({ value: e }) => yu(e) ? e.toString() : JSON.stringify(e)
	},
	{
		identify: (e) => typeof e == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
		resolve: (e) => parseFloat(e),
		stringify: bu
	}
], Su = [tu, iu].concat(xu, {
	default: !0,
	tag: "",
	test: /^/,
	resolve(e, t) {
		return t(`Unresolved plain scalar ${JSON.stringify(e)}`), e;
	}
}), Cu = {
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
		return Pl({
			comment: e,
			type: t,
			value: s
		}, r, i, a);
	}
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/pairs.js
function wu(e, t) {
	if (Hc(e)) for (let n = 0; n < e.items.length; ++n) {
		let r = e.items[n];
		if (!B(r)) {
			if (Vc(r)) {
				r.items.length > 1 && t("Each pair must have its own sequence indicator");
				let e = r.items[0] || new G(new W(null));
				if (r.commentBefore && (e.key.commentBefore = e.key.commentBefore ? `${r.commentBefore}\n${e.key.commentBefore}` : r.commentBefore), r.comment) {
					let t = e.value ?? e.key;
					t.comment = t.comment ? `${r.comment}\n${t.comment}` : r.comment;
				}
				r = e;
			}
			e.items[n] = B(r) ? r : new G(r);
		}
	}
	else t("Expected a sequence for this tag");
	return e;
}
function Tu(e, t, n) {
	let { replacer: r } = n, i = new nu(e);
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
		i.items.push(Yl(o, s, n));
	}
	return i;
}
var Eu = {
	collection: "seq",
	default: !1,
	tag: "tag:yaml.org,2002:pairs",
	resolve: wu,
	createNode: Tu
}, Du = class e extends nu {
	constructor() {
		super(), this.add = K.prototype.add.bind(this), this.delete = K.prototype.delete.bind(this), this.get = K.prototype.get.bind(this), this.has = K.prototype.has.bind(this), this.set = K.prototype.set.bind(this), this.tag = e.tag;
	}
	toJSON(e, t) {
		if (!t) return super.toJSON(e);
		let n = /* @__PURE__ */ new Map();
		t?.onCreate && t.onCreate(n);
		for (let e of this.items) {
			let r, i;
			if (B(e) ? (r = ol(e.key, "", t), i = ol(e.value, r, t)) : r = ol(e, "", t), n.has(r)) throw Error("Ordered maps must not include duplicate keys");
			n.set(r, i);
		}
		return n;
	}
	static from(e, t, n) {
		let r = Tu(e, t, n), i = new this();
		return i.items = r.items, i;
	}
};
Du.tag = "tag:yaml.org,2002:omap";
var Ou = {
	collection: "seq",
	identify: (e) => e instanceof Map,
	nodeClass: Du,
	default: !1,
	tag: "tag:yaml.org,2002:omap",
	resolve(e, t) {
		let n = wu(e, t), r = [];
		for (let { key: e } of n.items) V(e) && (r.includes(e.value) ? t(`Ordered maps must not include duplicate keys: ${e.value}`) : r.push(e.value));
		return Object.assign(new Du(), n);
	},
	createNode: (e, t, n) => Du.from(e, t, n)
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/bool.js
function ku({ value: e, source: t }, n) {
	return t && (e ? Au : ju).test.test(t) ? t : e ? n.options.trueStr : n.options.falseStr;
}
var Au = {
	identify: (e) => e === !0,
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
	resolve: () => new W(!0),
	stringify: ku
}, ju = {
	identify: (e) => e === !1,
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
	resolve: () => new W(!1),
	stringify: ku
}, Mu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
	resolve: (e) => e.slice(-3).toLowerCase() === "nan" ? NaN : e[0] === "-" ? -Infinity : Infinity,
	stringify: cu
}, Nu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "EXP",
	test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
	resolve: (e) => parseFloat(e.replace(/_/g, "")),
	stringify(e) {
		let t = Number(e.value);
		return isFinite(t) ? t.toExponential() : cu(e);
	}
}, Pu = {
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
	stringify: cu
}, Fu = (e) => typeof e == "bigint" || Number.isInteger(e);
function Iu(e, t, n, { intAsBigInt: r }) {
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
function Lu(e, t, n) {
	let { value: r } = e;
	if (Fu(r)) {
		let e = r.toString(t);
		return r < 0 ? "-" + n + e.substr(1) : n + e;
	}
	return cu(e);
}
var Ru = {
	identify: Fu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "BIN",
	test: /^[-+]?0b[0-1_]+$/,
	resolve: (e, t, n) => Iu(e, 2, 2, n),
	stringify: (e) => Lu(e, 2, "0b")
}, zu = {
	identify: Fu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "OCT",
	test: /^[-+]?0[0-7_]+$/,
	resolve: (e, t, n) => Iu(e, 1, 8, n),
	stringify: (e) => Lu(e, 8, "0")
}, Bu = {
	identify: Fu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	test: /^[-+]?[0-9][0-9_]*$/,
	resolve: (e, t, n) => Iu(e, 0, 10, n),
	stringify: cu
}, Vu = {
	identify: Fu,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "HEX",
	test: /^[-+]?0x[0-9a-fA-F_]+$/,
	resolve: (e, t, n) => Iu(e, 2, 16, n),
	stringify: (e) => Lu(e, 16, "0x")
}, Hu = class e extends K {
	constructor(t) {
		super(t), this.tag = e.tag;
	}
	add(e) {
		let t;
		t = B(e) ? e : e && typeof e == "object" && "key" in e && "value" in e && e.value === null ? new G(e.key, null) : new G(e, null), eu(this.items, t.key) || this.items.push(t);
	}
	get(e, t) {
		let n = eu(this.items, e);
		return !t && B(n) ? V(n.key) ? n.key.value : n.key : n;
	}
	set(e, t) {
		if (typeof t != "boolean") throw Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof t}`);
		let n = eu(this.items, e);
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
		if (t && Symbol.iterator in Object(t)) for (let e of t) typeof r == "function" && (e = r.call(t, e, e)), i.items.push(Yl(e, null, n));
		return i;
	}
};
Hu.tag = "tag:yaml.org,2002:set";
var Uu = {
	collection: "map",
	identify: (e) => e instanceof Set,
	nodeClass: Hu,
	default: !1,
	tag: "tag:yaml.org,2002:set",
	createNode: (e, t, n) => Hu.from(e, t, n),
	resolve(e, t) {
		if (Vc(e)) {
			if (e.hasAllNullValues(!0)) return Object.assign(new Hu(), e);
			t("Set items must all have null values");
		} else t("Expected a mapping for this tag");
		return e;
	}
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/timestamp.js
function Wu(e, t) {
	let n = e[0], r = n === "-" || n === "+" ? e.substring(1) : e, i = (e) => t ? BigInt(e) : Number(e), a = r.replace(/_/g, "").split(":").reduce((e, t) => e * i(60) + i(t), i(0));
	return n === "-" ? i(-1) * a : a;
}
function Gu(e) {
	let { value: t } = e, n = (e) => e;
	if (typeof t == "bigint") n = (e) => BigInt(e);
	else if (isNaN(t) || !isFinite(t)) return cu(e);
	let r = "";
	t < 0 && (r = "-", t *= n(-1));
	let i = n(60), a = [t % i];
	return t < 60 ? a.unshift(0) : (t = (t - a[0]) / i, a.unshift(t % i), t >= 60 && (t = (t - a[0]) / i, a.unshift(t))), r + a.map((e) => String(e).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
}
var Ku = {
	identify: (e) => typeof e == "bigint" || Number.isInteger(e),
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "TIME",
	test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
	resolve: (e, t, { intAsBigInt: n }) => Wu(e, n),
	stringify: Gu
}, qu = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "TIME",
	test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
	resolve: (e) => Wu(e, !1),
	stringify: Gu
}, Ju = {
	identify: (e) => e instanceof Date,
	default: !0,
	tag: "tag:yaml.org,2002:timestamp",
	test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
	resolve(e) {
		let t = e.match(Ju.test);
		if (!t) throw Error("!!timestamp expects a date, starting with yyyy-mm-dd");
		let [, n, r, i, a, o, s] = t.map(Number), c = t[7] ? Number((t[7] + "00").substr(1, 3)) : 0, l = Date.UTC(n, r - 1, i, a || 0, o || 0, s || 0, c), u = t[8];
		if (u && u !== "Z") {
			let e = Wu(u, !1);
			Math.abs(e) < 30 && (e *= 60), l -= 6e4 * e;
		}
		return new Date(l);
	},
	stringify: ({ value: e }) => e?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
}, Yu = [
	tu,
	iu,
	au,
	ou,
	Au,
	ju,
	Ru,
	zu,
	Bu,
	Vu,
	Mu,
	Nu,
	Pu,
	Cu,
	Hl,
	Ou,
	Eu,
	Uu,
	Ku,
	qu,
	Ju
], Xu = /* @__PURE__ */ new Map([
	["core", vu],
	["failsafe", [
		tu,
		iu,
		au
	]],
	["json", Su],
	["yaml11", Yu],
	["yaml-1.1", Yu]
]), Zu = {
	binary: Cu,
	bool: su,
	float: du,
	floatExp: uu,
	floatNaN: lu,
	floatTime: qu,
	int: gu,
	intHex: _u,
	intOct: hu,
	intTime: Ku,
	map: tu,
	merge: Hl,
	null: ou,
	omap: Ou,
	pairs: Eu,
	seq: iu,
	set: Uu,
	timestamp: Ju
}, Qu = {
	"tag:yaml.org,2002:binary": Cu,
	"tag:yaml.org,2002:merge": Hl,
	"tag:yaml.org,2002:omap": Ou,
	"tag:yaml.org,2002:pairs": Eu,
	"tag:yaml.org,2002:set": Uu,
	"tag:yaml.org,2002:timestamp": Ju
};
function $u(e, t, n) {
	let r = Xu.get(t);
	if (r && !e) return n && !r.includes(Hl) ? r.concat(Hl) : r.slice();
	let i = r;
	if (!i) {
		if (Array.isArray(e)) i = [];
		else {
			let e = Array.from(Xu.keys()).filter((e) => e !== "yaml11").map((e) => JSON.stringify(e)).join(", ");
			throw Error(`Unknown schema "${t}"; use one of ${e} or define customTags array`);
		}
	}
	if (Array.isArray(e)) for (let t of e) i = i.concat(t);
	else typeof e == "function" && (i = e(i.slice()));
	return n && (i = i.concat(Hl)), i.reduce((e, t) => {
		let n = typeof t == "string" ? Zu[t] : t;
		if (!n) {
			let e = JSON.stringify(t), n = Object.keys(Zu).map((e) => JSON.stringify(e)).join(", ");
			throw Error(`Unknown custom tag ${e}; use one of ${n}`);
		}
		return e.includes(n) || e.push(n), e;
	}, []);
}
// node_modules/yaml/browser/dist/schema/Schema.js
var ed = (e, t) => e.key < t.key ? -1 : +(e.key > t.key), td = class e {
	constructor({ compat: e, customTags: t, merge: n, resolveKnownTags: r, schema: i, sortMapEntries: a, toStringDefaults: o }) {
		this.compat = Array.isArray(e) ? $u(e, "compat") : e ? $u(null, e) : null, this.name = typeof i == "string" && i || "core", this.knownTags = r ? Qu : {}, this.tags = $u(t, this.name, n), this.toStringOptions = o ?? null, Object.defineProperty(this, Pc, { value: tu }), Object.defineProperty(this, Ic, { value: au }), Object.defineProperty(this, Lc, { value: iu }), this.sortMapEntries = typeof a == "function" ? a : a === !0 ? ed : null;
	}
	clone() {
		let t = Object.create(e.prototype, Object.getOwnPropertyDescriptors(this));
		return t.tags = this.tags.slice(), t;
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyDocument.js
function nd(e, t) {
	let n = [], r = t.directives === !0;
	if (t.directives !== !1 && e.directives) {
		let t = e.directives.toString(e);
		t ? (n.push(t), r = !0) : e.directives.docStart && (r = !0);
	}
	r && n.push("---");
	let i = Fl(e, t), { commentString: a } = i.options;
	if (e.commentBefore) {
		n.length !== 1 && n.unshift("");
		let t = a(e.commentBefore);
		n.unshift(vl(t, ""));
	}
	let o = !1, s = null;
	if (e.contents) {
		if (U(e.contents)) {
			if (e.contents.spaceBefore && r && n.push(""), e.contents.commentBefore) {
				let t = a(e.contents.commentBefore);
				n.push(vl(t, ""));
			}
			i.forceBlockIndent = !!e.comment, s = e.contents.comment;
		}
		let t = s ? void 0 : () => o = !0, c = Rl(e.contents, i, () => s = null, t);
		s && (c += yl(c, "", a(s))), (c[0] === "|" || c[0] === ">") && n[n.length - 1] === "---" ? n[n.length - 1] = `--- ${c}` : n.push(c);
	} else n.push(Rl(e.contents, i));
	if (e.directives?.docEnd) {
		if (e.comment) {
			let t = a(e.comment);
			t.includes("\n") ? (n.push("..."), n.push(vl(t, ""))) : n.push(`... ${t}`);
		} else n.push("...");
	} else {
		let t = e.comment;
		t && o && (t = t.replace(/^\n+/, "")), t && ((!o || s) && n[n.length - 1] !== "" && n.push(""), n.push(vl(a(t), "")));
	}
	return n.join("\n") + "\n";
}
// node_modules/yaml/browser/dist/doc/Document.js
var rd = class e {
	constructor(e, t, n) {
		this.commentBefore = null, this.comment = null, this.errors = [], this.warnings = [], Object.defineProperty(this, Rc, { value: Nc });
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
		n?._directives ? (this.directives = n._directives.atDocument(), this.directives.yaml.explicit && (a = this.directives.yaml.version)) : this.directives = new el({ version: a }), this.setSchema(a, n), this.contents = e === void 0 ? null : this.createNode(e, r, n);
	}
	clone() {
		let t = Object.create(e.prototype, { [Rc]: { value: Nc } });
		return t.commentBefore = this.commentBefore, t.comment = this.comment, t.errors = this.errors.slice(), t.warnings = this.warnings.slice(), t.options = Object.assign({}, this.options), this.directives && (t.directives = this.directives.clone()), t.schema = this.schema.clone(), t.contents = U(this.contents) ? this.contents.clone(t.schema) : this.contents, this.range && (t.range = this.range.slice()), t;
	}
	add(e) {
		id(this.contents) && this.contents.add(e);
	}
	addIn(e, t) {
		id(this.contents) && this.contents.addIn(e, t);
	}
	createAlias(e, t) {
		if (!e.anchor) {
			let n = nl(this);
			e.anchor = !t || n.has(t) ? rl(t || "a", n) : t;
		}
		return new cl(e.anchor);
	}
	createNode(e, t, n) {
		let r;
		if (typeof t == "function") e = t.call({ "": e }, "", e), r = t;
		else if (Array.isArray(t)) {
			let e = t.filter((e) => typeof e == "number" || e instanceof String || e instanceof Number).map(String);
			e.length > 0 && (t = t.concat(e)), r = t;
		} else n === void 0 && t && (n = t, t = void 0);
		let { aliasDuplicateObjects: i, anchorPrefix: a, flow: o, keepUndefined: s, onTagObj: c, tag: l } = n ?? {}, { onAnchor: u, setAnchors: d, sourceObjects: f } = il(this, a || "a"), p = {
			aliasDuplicateObjects: i ?? !0,
			keepUndefined: s ?? !1,
			onAnchor: u,
			onTagObj: c,
			replacer: r,
			schema: this.schema,
			sourceObjects: f
		}, m = pl(e, l, p);
		return o && H(m) && (m.flow = !0), d(), m;
	}
	createPair(e, t, n = {}) {
		return new G(this.createNode(e, null, n), this.createNode(t, null, n));
	}
	delete(e) {
		return id(this.contents) ? this.contents.delete(e) : !1;
	}
	deleteIn(e) {
		return hl(e) ? this.contents != null && (this.contents = null, !0) : id(this.contents) ? this.contents.deleteIn(e) : !1;
	}
	get(e, t) {
		return H(this.contents) ? this.contents.get(e, t) : void 0;
	}
	getIn(e, t) {
		return hl(e) ? !t && V(this.contents) ? this.contents.value : this.contents : H(this.contents) ? this.contents.getIn(e, t) : void 0;
	}
	has(e) {
		return H(this.contents) ? this.contents.has(e) : !1;
	}
	hasIn(e) {
		return hl(e) ? this.contents !== void 0 : H(this.contents) ? this.contents.hasIn(e) : !1;
	}
	set(e, t) {
		this.contents == null ? this.contents = ml(this.schema, [e], t) : id(this.contents) && this.contents.set(e, t);
	}
	setIn(e, t) {
		hl(e) ? this.contents = t : this.contents == null ? this.contents = ml(this.schema, Array.from(e), t) : id(this.contents) && this.contents.setIn(e, t);
	}
	setSchema(e, t = {}) {
		typeof e == "number" && (e = String(e));
		let n;
		switch (e) {
			case "1.1":
				this.directives ? this.directives.yaml.version = "1.1" : this.directives = new el({ version: "1.1" }), n = {
					resolveKnownTags: !1,
					schema: "yaml-1.1"
				};
				break;
			case "1.2":
			case "next":
				this.directives ? this.directives.yaml.version = e : this.directives = new el({ version: e }), n = {
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
		else if (n) this.schema = new td(Object.assign(n, t));
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
		}, s = ol(this.contents, t ?? "", o);
		if (typeof i == "function") for (let { count: e, res: t } of o.anchors.values()) i(t, e);
		return typeof a == "function" ? al(a, { "": s }, "", s) : s;
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
		return nd(this, e);
	}
};
function id(e) {
	if (H(e)) return !0;
	throw Error("Expected a YAML collection as document contents");
}
// node_modules/yaml/browser/dist/errors.js
var ad = class extends Error {
	constructor(e, t, n, r) {
		super(), this.name = e, this.code = n, this.message = r, this.pos = t;
	}
}, od = class extends ad {
	constructor(e, t, n) {
		super("YAMLParseError", e, t, n);
	}
}, sd = class extends ad {
	constructor(e, t, n) {
		super("YAMLWarning", e, t, n);
	}
}, cd = (e, t) => (n) => {
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
function ld(e, { flow: t, indicator: n, next: r, offset: i, onError: a, parentIndent: o, startOnNewline: s }) {
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
function ud(e) {
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
				if (ud(t.key) || ud(t.value)) return !0;
			}
			return !1;
		default: return !0;
	}
}
// node_modules/yaml/browser/dist/compose/util-flow-indent-check.js
function dd(e, t, n) {
	if (t?.type === "flow-collection") {
		let r = t.end[0];
		r.indent === e && (r.source === "]" || r.source === "}") && ud(t) && n(r, "BAD_INDENT", "Flow end indicator should be more indented than parent", !0);
	}
}
// node_modules/yaml/browser/dist/compose/util-map-includes.js
function fd(e, t, n) {
	let { uniqueKeys: r } = e.options;
	if (r === !1) return !1;
	let i = typeof r == "function" ? r : (e, t) => e === t || V(e) && V(t) && e.value === t.value;
	return t.some((e) => i(e.key, n));
}
// node_modules/yaml/browser/dist/compose/resolve-block-map.js
var pd = "All mapping items must start at the same column";
function md({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = new ((a?.nodeClass) ?? K)(n.schema);
	n.atRoot &&= !1;
	let s = r.offset, c = null;
	for (let a of r.items) {
		let { start: l, key: u, sep: d, value: f } = a, p = ld(l, {
			indicator: "explicit-key-ind",
			next: u ?? d?.[0],
			offset: s,
			onError: i,
			parentIndent: r.indent,
			startOnNewline: !0
		}), m = !p.found;
		if (m) {
			if (u && (u.type === "block-seq" ? i(s, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key") : "indent" in u && u.indent !== r.indent && i(s, "BAD_INDENT", pd)), !p.anchor && !p.tag && !d) {
				c = p.end, p.comment && (o.comment ? o.comment += "\n" + p.comment : o.comment = p.comment);
				continue;
			}
			(p.newlineAfterProp || ud(u)) && i(u ?? l[l.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
		} else p.found?.indent !== r.indent && i(s, "BAD_INDENT", pd);
		n.atKey = !0;
		let h = p.end, g = u ? e(n, u, p, i) : t(n, h, l, null, p, i);
		n.schema.compat && dd(r.indent, u, i), n.atKey = !1, fd(n, o.items, g) && i(h, "DUPLICATE_KEY", "Map keys must be unique");
		let _ = ld(d ?? [], {
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
			n.schema.compat && dd(r.indent, f, i), s = c.range[2];
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
function hd({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = new ((a?.nodeClass) ?? nu)(n.schema);
	n.atRoot &&= !1, n.atKey &&= !1;
	let s = r.offset, c = null;
	for (let { start: a, value: l } of r.items) {
		let u = ld(a, {
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
		n.schema.compat && dd(r.indent, l, i), s = d.range[2], o.items.push(d);
	}
	return o.range = [
		r.offset,
		s,
		c ?? s
	], o;
}
// node_modules/yaml/browser/dist/compose/resolve-end.js
function gd(e, t, n, r) {
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
var _d = "Block collections are not allowed within flow collections", vd = (e) => e && (e.type === "block-map" || e.type === "block-seq");
function yd({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = r.start.source === "{", s = o ? "flow map" : "flow sequence", c = new ((a?.nodeClass) ?? (o ? K : nu))(n.schema);
	c.flow = !0;
	let l = n.atRoot;
	l && (n.atRoot = !1), n.atKey &&= !1;
	let u = r.offset + r.start.source.length;
	for (let a = 0; a < r.items.length; ++a) {
		let l = r.items[a], { start: d, key: f, sep: p, value: m } = l, h = ld(d, {
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
			!o && n.options.strict && ud(f) && i(f, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
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
				B(t) && (t = t.value ?? t.key), t.comment ? t.comment += "\n" + e : t.comment = e, h.comment = h.comment.substring(e.length + 1);
			}
		}
		if (!o && !p && !h.found) {
			let r = m ? e(n, m, h, i) : t(n, h.end, p, null, h, i);
			c.items.push(r), u = r.range[2], vd(m) && i(r.range, "BLOCK_IN_FLOW", _d);
		} else {
			n.atKey = !0;
			let a = h.end, g = f ? e(n, f, h, i) : t(n, a, d, null, h, i);
			vd(f) && i(g.range, "BLOCK_IN_FLOW", _d), n.atKey = !1;
			let _ = ld(p ?? [], {
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
			v ? vd(m) && i(v.range, "BLOCK_IN_FLOW", _d) : _.comment && (g.comment ? g.comment += "\n" + _.comment : g.comment = _.comment);
			let y = new G(g, v);
			if (n.options.keepSourceTokens && (y.srcToken = l), o) {
				let e = c;
				fd(n, e.items, g) && i(a, "DUPLICATE_KEY", "Map keys must be unique"), e.items.push(y);
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
		let e = gd(p, m, n.options.strict, i);
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
function bd(e, t, n, r, i, a) {
	let o = n.type === "block-map" ? md(e, t, n, r, a) : n.type === "block-seq" ? hd(e, t, n, r, a) : yd(e, t, n, r, a), s = o.constructor;
	return i === "!" || i === s.tagName ? (o.tag = s.tagName, o) : (i && (o.tag = i), o);
}
function xd(e, t, n, r, i) {
	let a = r.tag, o = a ? t.directives.tagName(a.source, (e) => i(a, "TAG_RESOLVE_FAILED", e)) : null;
	if (n.type === "block-seq") {
		let { anchor: e, newlineAfterProp: t } = r, n = e && a ? e.offset > a.offset ? e : a : e ?? a;
		n && (!t || t.offset < n.offset) && i(n, "MISSING_CHAR", "Missing newline after block sequence props");
	}
	let s = n.type === "block-map" ? "map" : n.type === "block-seq" ? "seq" : n.start.source === "{" ? "map" : "seq";
	if (!a || !o || o === "!" || o === K.tagName && s === "map" || o === nu.tagName && s === "seq") return bd(e, t, n, i, o);
	let c = t.schema.tags.find((e) => e.tag === o && e.collection === s);
	if (!c) {
		let r = t.schema.knownTags[o];
		if (r?.collection === s) t.schema.tags.push(Object.assign({}, r, { default: !1 })), c = r;
		else return r ? i(a, "BAD_COLLECTION_TYPE", `${r.tag} used for ${s} collection, but expects ${r.collection ?? "scalar"}`, !0) : i(a, "TAG_RESOLVE_FAILED", `Unresolved tag: ${o}`, !0), bd(e, t, n, i, o);
	}
	let l = bd(e, t, n, i, o, c), u = c.resolve?.(l, (e) => i(a, "TAG_RESOLVE_FAILED", e), t.options) ?? l, d = U(u) ? u : new W(u);
	return d.range = l.range, d.tag = o, c?.format && (d.format = c.format), d;
}
// node_modules/yaml/browser/dist/compose/resolve-block-scalar.js
function Sd(e, t, n) {
	let r = t.offset, i = Cd(t, e.options.strict, n);
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
	let a = i.mode === ">" ? W.BLOCK_FOLDED : W.BLOCK_LITERAL, o = t.source ? wd(t.source) : [], s = o.length;
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
function Cd({ offset: e, props: t }, n, r) {
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
function wd(e) {
	let t = e.split(/\n( *)/), n = t[0], r = n.match(/^( *)/), i = [r?.[1] ? [r[1], n.slice(r[1].length)] : ["", n]];
	for (let e = 1; e < t.length; e += 2) i.push([t[e], t[e + 1]]);
	return i;
}
// node_modules/yaml/browser/dist/compose/resolve-flow-scalar.js
function Td(e, t, n) {
	let { offset: r, type: i, source: a, end: o } = e, s, c, l = (e, t, i) => n(r + e, t, i);
	switch (i) {
		case "scalar":
			s = W.PLAIN, c = Ed(a, l);
			break;
		case "single-quoted-scalar":
			s = W.QUOTE_SINGLE, c = Dd(a, l);
			break;
		case "double-quoted-scalar":
			s = W.QUOTE_DOUBLE, c = kd(a, l);
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
	let u = r + a.length, d = gd(o, u, t, n);
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
function Ed(e, t) {
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
	return n && t(0, "BAD_SCALAR_START", `Plain value cannot start with ${n}`), Od(e);
}
function Dd(e, t) {
	return (e[e.length - 1] !== "'" || e.length === 1) && t(e.length, "MISSING_CHAR", "Missing closing 'quote"), Od(e.slice(1, -1)).replace(/''/g, "'");
}
function Od(e) {
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
function kd(e, t) {
	let n = "";
	for (let r = 1; r < e.length - 1; ++r) {
		let i = e[r];
		if (i !== "\r" || e[r + 1] !== "\n") {
			if (i === "\n") {
				let { fold: t, offset: i } = Ad(e, r);
				n += t, r = i;
			} else if (i === "\\") {
				let i = e[++r], a = jd[i];
				if (a) n += a;
				else if (i === "\n") for (i = e[r + 1]; i === " " || i === "	";) i = e[++r + 1];
				else if (i === "\r" && e[r + 1] === "\n") for (i = e[++r + 1]; i === " " || i === "	";) i = e[++r + 1];
				else if (i === "x" || i === "u" || i === "U") {
					let a = i === "x" ? 2 : i === "u" ? 4 : 8;
					n += Md(e, r + 1, a, t), r += a;
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
function Ad(e, t) {
	let n = "", r = e[t + 1];
	for (; (r === " " || r === "	" || r === "\n" || r === "\r") && (r !== "\r" || e[t + 2] === "\n");) r === "\n" && (n += "\n"), t += 1, r = e[t + 1];
	return n ||= " ", {
		fold: n,
		offset: t
	};
}
var jd = {
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
function Md(e, t, n, r) {
	let i = e.substr(t, n), a = i.length === n && /^[0-9a-fA-F]+$/.test(i) ? parseInt(i, 16) : NaN;
	try {
		return String.fromCodePoint(a);
	} catch {
		let i = e.substr(t - 2, n + 2);
		return r(t - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${i}`), i;
	}
}
// node_modules/yaml/browser/dist/compose/compose-scalar.js
function Nd(e, t, n, r) {
	let { value: i, type: a, comment: o, range: s } = t.type === "block-scalar" ? Sd(e, t, r) : Td(t, e.options.strict, r), c = n ? e.directives.tagName(n.source, (e) => r(n, "TAG_RESOLVE_FAILED", e)) : null, l;
	l = e.options.stringKeys && e.atKey ? e.schema[Ic] : c ? Pd(e.schema, i, c, n, r) : t.type === "scalar" ? Fd(e, i, t, r) : e.schema[Ic];
	let u;
	try {
		let a = l.resolve(i, (e) => r(n ?? t, "TAG_RESOLVE_FAILED", e), e.options);
		u = V(a) ? a : new W(a);
	} catch (e) {
		let a = e instanceof Error ? e.message : String(e);
		r(n ?? t, "TAG_RESOLVE_FAILED", a), u = new W(i);
	}
	return u.range = s, u.source = i, a && (u.type = a), c && (u.tag = c), l.format && (u.format = l.format), o && (u.comment = o), u;
}
function Pd(e, t, n, r, i) {
	if (n === "!") return e[Ic];
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
	})), o) : (i(r, "TAG_RESOLVE_FAILED", `Unresolved tag: ${n}`, n !== "tag:yaml.org,2002:str"), e[Ic]);
}
function Fd({ atKey: e, directives: t, schema: n }, r, i, a) {
	let o = n.tags.find((t) => (t.default === !0 || e && t.default === "key") && t.test?.test(r)) || n[Ic];
	if (n.compat) {
		let e = n.compat.find((e) => e.default && e.test?.test(r)) ?? n[Ic];
		o.tag !== e.tag && a(i, "TAG_RESOLVE_FAILED", `Value may be parsed as either ${t.tagString(o.tag)} or ${t.tagString(e.tag)}`, !0);
	}
	return o;
}
// node_modules/yaml/browser/dist/compose/util-empty-scalar-position.js
function Id(e, t, n) {
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
var Ld = {
	composeNode: Rd,
	composeEmptyNode: zd
};
function Rd(e, t, n, r) {
	let i = e.atKey, { spaceBefore: a, comment: o, anchor: s, tag: c } = n, l, u = !0;
	switch (t.type) {
		case "alias":
			l = Bd(e, t, r), (s || c) && r(t, "ALIAS_PROPS", "An alias node must not specify any properties");
			break;
		case "scalar":
		case "single-quoted-scalar":
		case "double-quoted-scalar":
		case "block-scalar":
			l = Nd(e, t, c, r), s && (l.anchor = s.source.substring(1));
			break;
		case "block-map":
		case "block-seq":
		case "flow-collection":
			try {
				l = xd(Ld, e, t, n, r), s && (l.anchor = s.source.substring(1));
			} catch (e) {
				r(t, "RESOURCE_EXHAUSTION", e instanceof Error ? e.message : String(e));
			}
			break;
		default: r(t, "UNEXPECTED_TOKEN", t.type === "error" ? t.message : `Unsupported token (type: ${t.type})`), u = !1;
	}
	return l ??= zd(e, t.offset, void 0, null, n, r), s && l.anchor === "" && r(s, "BAD_ALIAS", "Anchor cannot be an empty string"), i && e.options.stringKeys && (!V(l) || typeof l.value != "string" || l.tag && l.tag !== "tag:yaml.org,2002:str") && r(c ?? t, "NON_STRING_KEY", "With stringKeys, all keys must be strings"), a && (l.spaceBefore = !0), o && (t.type === "scalar" && t.source === "" ? l.comment = o : l.commentBefore = o), e.options.keepSourceTokens && u && (l.srcToken = t), l;
}
function zd(e, t, n, r, { spaceBefore: i, comment: a, anchor: o, tag: s, end: c }, l) {
	let u = Nd(e, {
		type: "scalar",
		offset: Id(t, n, r),
		indent: -1,
		source: ""
	}, s, l);
	return o && (u.anchor = o.source.substring(1), u.anchor === "" && l(o, "BAD_ALIAS", "Anchor cannot be an empty string")), i && (u.spaceBefore = !0), a && (u.comment = a, u.range[2] = c), u;
}
function Bd({ options: e }, { offset: t, source: n, end: r }, i) {
	let a = new cl(n.substring(1));
	a.source === "" && i(t, "BAD_ALIAS", "Alias cannot be an empty string"), a.source.endsWith(":") && i(t + n.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", !0);
	let o = t + n.length, s = gd(r, o, e.strict, i);
	return a.range = [
		t,
		o,
		s.offset
	], s.comment && (a.comment = s.comment), a;
}
// node_modules/yaml/browser/dist/compose/compose-doc.js
function Vd(e, t, { offset: n, start: r, value: i, end: a }, o) {
	let s = new rd(void 0, Object.assign({ _directives: t }, e)), c = {
		atKey: !1,
		atRoot: !0,
		directives: s.directives,
		options: s.options,
		schema: s.schema
	}, l = ld(r, {
		indicator: "doc-start",
		next: i ?? a?.[0],
		offset: n,
		onError: o,
		parentIndent: 0,
		startOnNewline: !0
	});
	l.found && (s.directives.docStart = !0, i && (i.type === "block-map" || i.type === "block-seq") && !l.hasNewline && o(l.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker")), s.contents = i ? Rd(c, i, l, o) : zd(c, l.end, r, null, l, o);
	let u = s.contents.range[2], d = gd(a, u, !1, o);
	return d.comment && (s.comment = d.comment), s.range = [
		n,
		u,
		d.offset
	], s;
}
// node_modules/yaml/browser/dist/compose/composer.js
function Hd(e) {
	if (typeof e == "number") return [e, e + 1];
	if (Array.isArray(e)) return e.length === 2 ? e : [e[0], e[1]];
	let { offset: t, source: n } = e;
	return [t, t + (typeof n == "string" ? n.length : 1)];
}
function Ud(e) {
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
var Wd = class {
	constructor(e = {}) {
		this.doc = null, this.atDirectives = !1, this.prelude = [], this.errors = [], this.warnings = [], this.onError = (e, t, n, r) => {
			let i = Hd(e);
			r ? this.warnings.push(new sd(i, t, n)) : this.errors.push(new od(i, t, n));
		}, this.directives = new el({ version: e.version || "1.2" }), this.options = e;
	}
	decorate(e, t) {
		let { comment: n, afterEmptyLine: r } = Ud(this.prelude);
		if (n) {
			let i = e.contents;
			if (t) e.comment = e.comment ? `${e.comment}\n${n}` : n;
			else if (r || e.directives.docStart || !i) e.commentBefore = n;
			else if (H(i) && !i.flow && i.items.length > 0) {
				let e = i.items[0];
				B(e) && (e = e.key);
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
			comment: Ud(this.prelude).comment,
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
					let i = Hd(e);
					i[0] += t, this.onError(i, "BAD_DIRECTIVE", n, r);
				}), this.prelude.push(e.source), this.atDirectives = !0;
				break;
			case "document": {
				let t = Vd(this.options, this.directives, e, this.onError);
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
				let t = e.source ? `${e.message}: ${JSON.stringify(e.source)}` : e.message, n = new od(Hd(e), "UNEXPECTED_TOKEN", t);
				this.atDirectives || !this.doc ? this.errors.push(n) : this.doc.errors.push(n);
				break;
			}
			case "doc-end": {
				if (!this.doc) {
					this.errors.push(new od(Hd(e), "UNEXPECTED_TOKEN", "Unexpected doc-end without preceding document"));
					break;
				}
				this.doc.directives.docEnd = !0;
				let t = gd(e.end, e.offset + e.source.length, this.doc.options.strict, this.onError);
				if (this.decorate(this.doc, !0), t.comment) {
					let e = this.doc.comment;
					this.doc.comment = e ? `${e}\n${t.comment}` : t.comment;
				}
				this.doc.range[2] = t.offset;
				break;
			}
			default: this.errors.push(new od(Hd(e), "UNEXPECTED_TOKEN", `Unsupported token ${e.type}`));
		}
	}
	*end(e = !1, t = -1) {
		if (this.doc) this.decorate(this.doc, !0), yield this.doc, this.doc = null;
		else if (e) {
			let e = new rd(void 0, Object.assign({ _directives: this.directives }, this.options));
			this.atDirectives && this.onError(t, "MISSING_CHAR", "Missing directives-end indicator line"), e.range = [
				0,
				t,
				t
			], this.decorate(e, !1), yield e;
		}
	}
}, Gd = Symbol("break visit"), Kd = Symbol("skip children"), qd = Symbol("remove item");
function Jd(e, t) {
	"type" in e && e.type === "document" && (e = {
		start: e.start,
		value: e.value
	}), Yd(Object.freeze([]), e, t);
}
Jd.BREAK = Gd, Jd.SKIP = Kd, Jd.REMOVE = qd, Jd.itemAtPath = (e, t) => {
	let n = e;
	for (let [e, r] of t) {
		let t = n?.[e];
		if (t && "items" in t) n = t.items[r];
		else return;
	}
	return n;
}, Jd.parentCollection = (e, t) => {
	let n = Jd.itemAtPath(e, t.slice(0, -1)), r = t[t.length - 1][0], i = n?.[r];
	if (i && "items" in i) return i;
	throw Error("Parent collection not found");
};
function Yd(e, t, n) {
	let r = n(t, e);
	if (typeof r == "symbol") return r;
	for (let i of ["key", "value"]) {
		let a = t[i];
		if (a && "items" in a) {
			for (let t = 0; t < a.items.length; ++t) {
				let r = Yd(Object.freeze(e.concat([[i, t]])), a.items[t], n);
				if (typeof r == "number") t = r - 1;
				else if (r === Gd) return Gd;
				else r === qd && (a.items.splice(t, 1), --t);
			}
			typeof r == "function" && i === "key" && (r = r(t, e));
		}
	}
	return typeof r == "function" ? r(t, e) : r;
}
function Xd(e) {
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
function Zd(e) {
	switch (e) {
		case void 0:
		case " ":
		case "\n":
		case "\r":
		case "	": return !0;
		default: return !1;
	}
}
var Qd = /* @__PURE__ */ new Set("0123456789ABCDEFabcdef"), $d = /* @__PURE__ */ new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()"), ef = /* @__PURE__ */ new Set(",[]{}"), tf = /* @__PURE__ */ new Set(" ,[]{}\n\r	"), nf = (e) => !e || tf.has(e), rf = class {
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
			if ((t === "---" || t === "...") && Zd(this.buffer[e + 3])) return -1;
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
			if ((e === "---" || e === "...") && Zd(this.charAt(3))) return yield* this.pushCount(3), this.indentValue = 0, this.indentNext = 0, e === "---" ? "doc" : "stream";
		}
		return this.indentValue = yield* this.pushSpaces(!1), this.indentNext > this.indentValue && !Zd(this.charAt(1)) && (this.indentNext = this.indentValue), yield* this.parseBlockStart();
	}
	*parseBlockStart() {
		let [e, t] = this.peek(2);
		if (!t && !this.atEnd) return this.setNext("block-start");
		if ((e === "-" || e === "?" || e === ":") && Zd(t)) {
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
			case "*": return yield* this.pushUntil(nf), "doc";
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
		if ((n !== -1 && n < this.indentNext && r[0] !== "#" || n === 0 && (r.startsWith("---") || r.startsWith("...")) && Zd(r[3])) && (n !== this.indentNext - 1 || this.flowLevel !== 1 || r[0] !== "]" && r[0] !== "}")) return this.flowLevel = 0, yield "", yield* this.parseLineStart();
		let i = 0;
		for (; r[i] === ",";) i += yield* this.pushCount(1), i += yield* this.pushSpaces(!0), this.flowKey = !1;
		switch (i += yield* this.pushIndicators(), r[i]) {
			case void 0: return "flow";
			case "#": return yield* this.pushCount(r.length - i), "flow";
			case "{":
			case "[": return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel += 1, "flow";
			case "}":
			case "]": return yield* this.pushCount(1), this.flowKey = !0, --this.flowLevel, this.flowLevel ? "flow" : "doc";
			case "*": return yield* this.pushUntil(nf), "flow";
			case "\"":
			case "'": return this.flowKey = !0, yield* this.parseQuotedScalar();
			case ":": {
				let e = this.charAt(1);
				if (this.flowKey || Zd(e) || e === ",") return this.flowKey = !1, yield* this.pushCount(1), yield* this.pushSpaces(!0), "flow";
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
		return yield* this.pushUntil((e) => Zd(e) || e === "#");
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
			if (Zd(r) || e && ef.has(r)) break;
			t = n;
		} else if (Zd(r)) {
			let i = this.buffer[n + 1];
			if (r === "\r" && (i === "\n" ? (n += 1, r = "\n", i = this.buffer[n + 1]) : t = n), i === "#" || e && ef.has(i)) break;
			if (r === "\n") {
				let e = this.continueScalar(n + 1);
				if (e === -1) break;
				n = Math.max(n, e - 2);
			}
		} else {
			if (e && ef.has(r)) break;
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
					e += yield* this.pushUntil(nf), e += yield* this.pushSpaces(!0);
					continue loop;
				case "-":
				case "?":
				case ":": {
					let t = this.flowLevel > 0, n = this.charAt(1);
					if (Zd(n) || t && ef.has(n)) {
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
			for (; !Zd(t) && t !== ">";) t = this.buffer[++e];
			return yield* this.pushToIndex(t === ">" ? e + 1 : e, !1);
		}
		{
			let e = this.pos + 1, t = this.buffer[e];
			for (; t;) if ($d.has(t)) t = this.buffer[++e];
			else if (t === "%" && Qd.has(this.buffer[e + 1]) && Qd.has(this.buffer[e + 2])) t = this.buffer[e += 3];
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
}, af = class {
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
function of(e, t) {
	for (let n = 0; n < e.length; ++n) if (e[n].type === t) return !0;
	return !1;
}
function sf(e) {
	for (let t = 0; t < e.length; ++t) switch (e[t].type) {
		case "space":
		case "comment":
		case "newline": break;
		default: return t;
	}
	return -1;
}
function cf(e) {
	switch (e?.type) {
		case "alias":
		case "scalar":
		case "single-quoted-scalar":
		case "double-quoted-scalar":
		case "flow-collection": return !0;
		default: return !1;
	}
}
function lf(e) {
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
function uf(e) {
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
function df(e, t) {
	if (t.length < 1e5) Array.prototype.push.apply(e, t);
	else for (let n = 0; n < t.length; ++n) e.push(t[n]);
}
function ff(e) {
	if (e.start.type === "flow-seq-start") for (let t of e.items) t.sep && !t.value && !of(t.start, "explicit-key-ind") && !of(t.sep, "map-value-ind") && (t.key && (t.value = t.key), delete t.key, cf(t.value) ? t.value.end ? df(t.value.end, t.sep) : t.value.end = t.sep : df(t.start, t.sep), delete t.sep);
}
var pf = class {
	constructor(e) {
		this.atNewLine = !0, this.atScalar = !1, this.indent = 0, this.offset = 0, this.onKeyLine = !1, this.stack = [], this.source = "", this.type = "", this.lexer = new rf(), this.onNewLine = e;
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
		let t = Xd(e);
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
			switch (t.type === "block-scalar" ? t.indent = "indent" in e ? e.indent : 0 : t.type === "flow-collection" && e.type === "document" && (t.indent = 0), t.type === "flow-collection" && ff(t), e.type) {
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
				n && !n.sep && !n.value && n.start.length > 0 && sf(n.start) === -1 && (t.indent === 0 || n.start.every((e) => e.type !== "comment" || e.indent < t.indent)) && (e.type === "document" ? e.end = n.start : e.items.push({ start: n.start }), t.items.splice(-1, 1));
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
				sf(e.start) === -1 ? e.start.push(this.sourceToken) : (yield* this.pop(), yield* this.step());
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
			let t = uf(lf(this.peek(2))), n;
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
							df(n, t.start), n.push(this.sourceToken), e.items.pop();
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
							if (of(t.start, "newline")) Object.assign(t, {
								key: null,
								sep: [this.sourceToken]
							});
							else {
								let e = uf(t.start);
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
						else if (of(t.sep, "map-value-ind")) this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: i,
								key: null,
								sep: [this.sourceToken]
							}]
						});
						else if (cf(t.key) && !of(t.sep, "newline")) {
							let e = uf(t.start), n = t.key, r = t.sep;
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
					}) : of(t.sep, "map-value-ind") ? this.stack.push({
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
							if (!t.explicitKey && t.sep && !of(t.sep, "newline")) {
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
							df(n, t.start), n.push(this.sourceToken), e.items.pop();
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
				t.value || of(t.start, "seq-item-ind") ? e.items.push({ start: [this.sourceToken] }) : t.start.push(this.sourceToken);
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
				let n = uf(lf(t));
				ff(e);
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
				let t = uf(lf(e));
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
				let t = uf(lf(e));
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
function mf(e) {
	let t = e.prettyErrors !== !1;
	return {
		lineCounter: e.lineCounter || t && new af() || null,
		prettyErrors: t
	};
}
function hf(e, t = {}) {
	let { lineCounter: n, prettyErrors: r } = mf(t), i = new pf(n?.addNewLine), a = new Wd(t), o = null;
	for (let t of a.compose(i.parse(e), !0, e.length)) if (!o) o = t;
	else if (o.options.logLevel !== "silent") {
		o.errors.push(new od(t.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
		break;
	}
	return r && n && (o.errors.forEach(cd(e, n)), o.warnings.forEach(cd(e, n))), o;
}
function gf(e, t, n) {
	let r;
	typeof t == "function" ? r = t : n === void 0 && t && typeof t == "object" && (n = t);
	let i = hf(e, n);
	if (!i) return null;
	if (i.warnings.forEach((e) => Bl(i.options.logLevel, e)), i.errors.length > 0) {
		if (i.options.logLevel !== "silent") throw i.errors[0];
		i.errors = [];
	}
	return i.toJS(Object.assign({ reviver: r }, n));
}
// src/server/catalog/frontmatter.ts
var _f = {
	UNTERMINATED: "FRONTMATTER_UNTERMINATED",
	INVALID_YAML: "FRONTMATTER_INVALID_YAML",
	NOT_A_MAPPING: "FRONTMATTER_NOT_A_MAPPING"
}, vf = class extends Error {
	code;
	constructor(e, t, n = {}) {
		super(t, n.cause === void 0 ? void 0 : { cause: n.cause }), this.name = new.target.name, this.code = e;
	}
}, yf = /^---[ \t]*(\r?\n|$)/, bf = /^---[ \t]*$/m;
function xf(e) {
	let t = Cf(e), n = yf.exec(t);
	if (!n) return {
		present: !1,
		data: {},
		body: t
	};
	let r = t.slice(n[0].length), i = bf.exec(r);
	if (!i) throw new vf(_f.UNTERMINATED, "The SKILL.md frontmatter is missing its closing \"---\" delimiter.");
	let a = r.slice(0, i.index), o = r.slice(i.index + i[0].length).replace(/^\r?\n/, "");
	if (a.trim() === "") return {
		present: !0,
		data: {},
		body: o
	};
	let s;
	try {
		s = gf(a);
	} catch (e) {
		throw new vf(_f.INVALID_YAML, "The SKILL.md frontmatter is not valid YAML.", { cause: e });
	}
	if (s == null) return {
		present: !0,
		data: {},
		body: o
	};
	if (!wf(s)) throw new vf(_f.NOT_A_MAPPING, "The SKILL.md frontmatter must be a YAML mapping.");
	return {
		present: !0,
		data: s,
		body: o
	};
}
function Sf(e, t) {
	if (!Object.hasOwn(e, t)) return;
	let n = e[t];
	if (typeof n != "string") return;
	let r = n.trim();
	return r === "" ? void 0 : r;
}
function Cf(e) {
	return e.charCodeAt(0) === 65279 ? e.slice(1) : e;
}
function wf(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
// src/shared/chain.ts
function Tf(e) {
	return e.label?.trim() || (e.kind === "instruction" ? "Instruction" : e.skillName);
}
var Ef = ["opencode", "copilot"], Df = L(Ef), q = N().trim().min(1), Of = I({
	opencode: q.optional(),
	copilot: q.optional()
}), kf = I({
	id: q,
	canonicalPath: q,
	displayName: q,
	lastOpenedAt: z({ offset: !0 }),
	managedWorkspace: R(!0).optional()
}), Af = I({
	version: R(1),
	projectDevice: N().regex(/^[0-9]+$/),
	projectInode: N().regex(/^[0-9]+$/)
}), jf = I({
	id: Cs(),
	projectId: q,
	sourceProjectId: q.optional(),
	sourceChainId: q.optional(),
	sourceDraftId: q.optional(),
	chainId: q,
	createdAt: z({ offset: !0 }),
	retirement: Af.optional()
}).superRefine((e, t) => {
	(e.sourceProjectId !== void 0 && e.sourceChainId !== void 0) == (e.sourceDraftId !== void 0) && t.addIssue({
		code: "custom",
		message: "A test workspace must have exactly one valid source chain or draft."
	}), e.sourceProjectId === void 0 != (e.sourceChainId === void 0) && t.addIssue({
		code: "custom",
		message: "A project source requires both project and chain ids."
	});
}), Mf = I({
	id: Cs(),
	projectId: q,
	chainId: q,
	harness: Df,
	createdAt: z({ offset: !0 }),
	handoffFingerprint: N().regex(/^[a-f0-9]{64}$/),
	autoImport: Gs(),
	runId: q.optional(),
	resultFingerprint: N().regex(/^[a-f0-9]{64}$/).optional(),
	importedDraftId: q.optional(),
	retirement: Af.optional()
}), Nf = N().trim().min(1).max(2048).refine((e) => {
	if (/^git@[^/:\\\s]+:[^\\\s?#]+(?:\.git)?$/i.test(e)) return !0;
	let t;
	try {
		t = new URL(e);
	} catch {
		return !1;
	}
	return (t.protocol === "https:" || t.protocol === "ssh:") && (t.username === "" || t.protocol === "ssh:" && t.username === "git") && t.password === "" && t.search === "" && t.hash === "" && t.hostname !== "";
}, "Use an HTTPS or SSH Git remote without embedded credentials or query parameters."), Pf = N().trim().min(1).max(255).refine((e) => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(e) && !e.includes("..") && !e.includes("//") && !e.includes("@{") && !e.endsWith("/") && !e.endsWith(".") && !e.split("/").some((e) => e.endsWith(".lock")), "Use a branch, tag, or full commit hash."), Ff = {
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
}, If = {
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
}, Lf = (e) => Vs().int().min(1).max(e), Rf = {
	maxPackages: Lf(If.maxPackages),
	maxAgents: Lf(If.maxAgents),
	maxFiles: Lf(If.maxFiles),
	maxPackageBytes: Lf(If.maxPackageBytes),
	maxSnapshotBytes: Lf(If.maxSnapshotBytes),
	maxStagingBytes: Lf(If.maxStagingBytes),
	maxStagingEntries: Lf(If.maxStagingEntries),
	maxCommandOutputBytes: Lf(If.maxCommandOutputBytes),
	cloneTimeoutMs: Lf(If.cloneTimeoutMs),
	commandTimeoutMs: Lf(If.commandTimeoutMs)
}, zf = I(Rf).partial(), Bf = I(Rf), Vf = I({
	id: N().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	repository: Nf,
	ref: Pf.optional()
}), Hf = Vf.extend({ limits: zf.optional() }), Uf = ac(N(), qs()), Wf = {
	harnessCommands: Of.default({}),
	extraSkillDirectories: F(q).default([]),
	sharedBundleDirectory: q.optional(),
	recentProjects: F(kf).default([]),
	testWorkspaces: F(jf).default([]),
	discoveryWorkspaces: F(Mf).default([]),
	uiPreferences: Uf.default({})
};
I({
	version: R(1),
	...Wf,
	remoteSkillSources: F(Vf).default([])
}), I({
	version: R(2),
	harnessCommands: Wf.harnessCommands,
	extraSkillDirectories: Wf.extraSkillDirectories,
	remoteSkillSources: F(Hf).default([]),
	remoteCatalogLimits: Bf.default(Ff),
	sharedBundleDirectory: Wf.sharedBundleDirectory,
	recentProjects: Wf.recentProjects,
	testWorkspaces: Wf.testWorkspaces,
	discoveryWorkspaces: Wf.discoveryWorkspaces,
	uiPreferences: Wf.uiPreferences
}), I({
	harnessCommands: Of.optional(),
	extraSkillDirectories: F(q).optional(),
	remoteSkillSources: F(Hf).optional(),
	remoteCatalogLimits: zf.optional(),
	sharedBundleDirectory: q.nullable().optional(),
	recentProjects: F(kf).optional(),
	testWorkspaces: F(jf).optional(),
	discoveryWorkspaces: F(Mf).optional(),
	uiPreferences: Uf.optional()
});
var Gf = L([
	"shared",
	"fresh",
	"fork"
]), Kf = /^[A-Za-z][A-Za-z0-9_]*$/, qf = N().trim().min(1), Jf = z({ offset: !0 }), Yf = I({
	harness: Df,
	name: qf,
	sourceId: N().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	revision: N().regex(/^[a-f0-9]{40,64}$/),
	repositoryPath: qf.max(4096),
	agentPath: qf.max(4096),
	fingerprint: N().regex(/^[a-f0-9]{64}$/)
}), Xf = I({
	sourceId: N().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	revision: N().regex(/^[a-f0-9]{40,64}$/),
	repositoryPath: qf.max(4096)
}), Zf = {
	id: qf,
	instruction: qf,
	label: qf.optional()
}, Qf = tc("kind", [I({
	...Zf,
	kind: R("skill").optional(),
	skillName: qf,
	skillBinding: Xf.optional()
}), I({
	...Zf,
	kind: R("instruction"),
	skillName: Ys().optional()
})]), $f = I({
	name: N().regex(Kf),
	label: qf.optional(),
	required: Gs().default(!1),
	defaultValue: N().optional()
}), ep = {
	id: qf,
	name: qf,
	harness: Df,
	sessionMode: Gf,
	steps: F(Qf).min(1),
	inputs: F($f).default([]),
	automaticPermissionOptIn: Gs().default(!1),
	createdAt: Jf,
	updatedAt: Jf
}, tp = tc("kind", [I({
	...Zf,
	kind: R("skill").optional(),
	skillName: qf
}), I({
	...Zf,
	kind: R("instruction"),
	skillName: Ys().optional()
})]), np = {
	...ep,
	steps: F(tp).min(1)
}, rp = I({
	version: R(1),
	...np
}), ip = I({
	version: R(2),
	...np,
	agent: Yf.optional()
}), J = I({
	version: R(3),
	...ep,
	agent: Yf.optional()
}), ap = {
	DUPLICATE_STEP_ID: "chain_duplicate_step_id",
	DUPLICATE_INPUT_NAME: "chain_duplicate_input_name",
	PLACEHOLDER_INVALID: "chain_placeholder_invalid",
	PLACEHOLDER_UNKNOWN: "chain_placeholder_unknown",
	AGENT_HARNESS_MISMATCH: "chain_agent_harness_mismatch",
	SKILL_BINDING_CONFLICT: "chain_skill_binding_conflict"
}, op = { INPUT_UNUSED: "chain_input_unused" }, sp = class extends Error {
	code;
	details;
	constructor(e, t, n = {}, r = {}) {
		super(t, r.cause === void 0 ? void 0 : { cause: r.cause }), this.name = new.target.name, this.code = e, this.details = n;
	}
}, cp = class extends sp {
	issues;
	constructor(e) {
		super("CHAIN_INVALID", "The chain is not valid.", { issues: e }), this.issues = e;
	}
};
function lp(e) {
	if (!yp(e)) return e;
	if (!Object.hasOwn(e, "version")) return {
		...e,
		version: 3
	};
	if (e.version === 1 || e.version === 2) {
		let t = (e.version === 1 ? rp : ip).safeParse(e);
		return t.success ? {
			...t.data,
			version: 3
		} : e;
	}
	return e;
}
function up(e) {
	let t = J.safeParse(e);
	if (!t.success) throw new cp(vp(t.error.issues));
	let n = t.data, r = [];
	if (n.agent !== void 0 && n.agent.harness !== n.harness && r.push({
		path: "agent.harness",
		code: ap.AGENT_HARNESS_MISMATCH,
		message: `The selected ${n.agent.harness} agent is incompatible with the ${n.harness} chain harness.`
	}), pp(n, r), mp(n, r), hp(n, r), gp(n, r), r.length > 0) throw new cp(r);
	return {
		chain: n,
		warnings: fp(n)
	};
}
function dp(e) {
	return up(e).chain;
}
function fp(e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e.steps) for (let e of _p(n.instruction)) t.add(e.name);
	let n = [];
	return e.inputs.forEach((e, r) => {
		t.has(e.name) || n.push({
			path: `inputs.${String(r)}.name`,
			code: op.INPUT_UNUSED,
			message: `Input "${e.name}" is declared but never used in an instruction.`,
			inputName: e.name
		});
	}), n;
}
function pp(e, t) {
	let n = /* @__PURE__ */ new Map();
	e.steps.forEach((e, r) => {
		let i = n.get(e.id);
		i === void 0 ? n.set(e.id, r) : t.push({
			path: `steps.${String(r)}.id`,
			code: ap.DUPLICATE_STEP_ID,
			message: `Step id "${e.id}" is already used by step ${String(i + 1)}.`,
			stepId: e.id,
			stepIndex: r
		});
	});
}
function mp(e, t) {
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
			code: ap.SKILL_BINDING_CONFLICT,
			message: `Skill steps named "${e.skillName}" cannot select different packages in one chain.`,
			stepId: e.id,
			stepIndex: r
		});
	});
}
function hp(e, t) {
	let n = /* @__PURE__ */ new Map();
	e.inputs.forEach((e, r) => {
		let i = n.get(e.name);
		i === void 0 ? n.set(e.name, r) : t.push({
			path: `inputs.${String(r)}.name`,
			code: ap.DUPLICATE_INPUT_NAME,
			message: `Input name "${e.name}" is already declared by input ${String(i + 1)}.`,
			inputName: e.name
		});
	});
}
function gp(e, t) {
	let n = new Set(e.inputs.map((e) => e.name));
	e.steps.forEach((e, r) => {
		let i = /* @__PURE__ */ new Set();
		for (let a of _p(e.instruction)) {
			if (i.has(a.name)) continue;
			let o = Tf(e);
			a.name === "" || !Kf.test(a.name) ? (i.add(a.name), t.push({
				path: `steps.${String(r)}.instruction`,
				code: ap.PLACEHOLDER_INVALID,
				message: `Step "${o}" contains an invalid placeholder "${a.raw}".`,
				stepId: e.id,
				stepIndex: r,
				inputName: a.name
			})) : n.has(a.name) || (i.add(a.name), t.push({
				path: `steps.${String(r)}.instruction`,
				code: ap.PLACEHOLDER_UNKNOWN,
				message: `Step "${o}" references undeclared input "${a.name}".`,
				stepId: e.id,
				stepIndex: r,
				inputName: a.name
			}));
		}
	});
}
function _p(e) {
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
function vp(e) {
	return e.map((e) => ({
		path: e.path.map((e) => String(e)).join("."),
		code: e.code,
		message: e.message
	}));
}
function yp(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
// src/portable/bundle.ts
var bp = 20971520, xp = 2e3, Sp = 31457280, Cp = class extends Error {
	code;
	constructor(e, t) {
		super(t), this.code = e, this.name = "BundleError";
	}
}, wp = /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i, Tp = I({
	path: N().min(1).max(512),
	content: N().max(Math.ceil(bp / 3) * 4),
	executable: Gs()
}), Ep = I({
	format: R("skill-loom-chain"),
	version: R(1),
	chain: I({
		name: J.shape.name,
		harness: J.shape.harness,
		sessionMode: J.shape.sessionMode,
		steps: J.shape.steps,
		inputs: J.shape.inputs
	}),
	skills: F(I({
		name: N().trim().min(1).max(128),
		directory: N().min(1).max(128).regex(/^[^/\\]+$/),
		files: F(Tp).min(1).max(xp)
	})).max(100)
}), Dp = I({
	name: N().trim().min(1).max(128),
	harness: J.shape.harness,
	agentPath: N().min(1).max(512),
	fingerprint: N().regex(/^[a-f0-9]{64}$/),
	content: N().max(Math.ceil(bp / 3) * 4)
}), Op = I({
	format: R("skill-loom-chain"),
	version: R(2),
	chain: I({
		name: J.shape.name,
		harness: J.shape.harness,
		sessionMode: J.shape.sessionMode,
		steps: J.shape.steps,
		inputs: J.shape.inputs,
		agent: Yf.optional()
	}),
	skills: F(I({
		name: N().trim().min(1).max(128),
		directory: N().min(1).max(128).regex(/^[^/\\]+$/),
		files: F(Tp).min(1).max(xp)
	})).max(100),
	agents: F(Dp).max(1)
});
function Y(e) {
	throw new Cp("BUNDLE_INVALID", e);
}
function kp(e) {
	let t = e.split("/");
	(t.length > 32 || t.some((e) => e === "." || e === ".." || !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(e) || /[. ]$/.test(e) || wp.test(e) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(e))) && Y("The bundle contains an unsafe or excluded package path.");
}
function Ap(e) {
	(e.length % 4 != 0 || /[^A-Za-z0-9+/=]/.test(e)) && Y("Package file contents must be canonical base64.");
	let t = Buffer.from(e, "base64");
	return t.toString("base64") !== e && Y("Package file contents are not canonical base64."), t;
}
function jp(e) {
	return [...new Set(e.steps.flatMap((e) => "skillName" in e && typeof e.skillName == "string" ? [e.skillName] : []))];
}
function Mp(e) {
	let t = e.version === 2 ? e.chain.agent : void 0;
	return dp({
		...e.chain,
		...t === void 0 ? {} : { agent: t },
		version: 3,
		id: "portable-bundle",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		automaticPermissionOptIn: !1
	});
}
function Np(e) {
	let t = Pp(e) ? e.version : void 0, n = t === 1 ? Ep.safeParse(e) : t === 2 ? Op.safeParse(e) : null;
	n === null && Y("The file is not a supported Skill Loom chain bundle."), n.success || Y("The file is not a supported Skill Loom chain bundle.");
	let r = n.data, i = Mp(r), a = new Set(jp(i)), o = /* @__PURE__ */ new Set(), s = /* @__PURE__ */ new Set(), c = 0, l = 0;
	for (let e of r.skills) {
		kp(e.directory);
		let t = e.directory.toLowerCase();
		(o.has(e.name) || s.has(t) || !a.has(e.name)) && Y("The bundle contains duplicate or unreferenced skill packages."), o.add(e.name), s.add(t);
		let n = /* @__PURE__ */ new Set();
		for (let t of e.files) {
			kp(t.path);
			let e = t.path.toLowerCase();
			if (n.has(e) && Y("The bundle contains duplicate package file paths."), n.add(e), c += Ap(t.content).length, l += 1, c > 20971520 || l > 2e3) throw new Cp("BUNDLE_TOO_LARGE", "Bundles are limited to 20 MiB and 2,000 files.");
		}
		for (let e of n) {
			let t = e.split("/");
			for (; t.length > 1;) t.pop(), n.has(t.join("/")) && Y("A package file conflicts with a directory.");
		}
		let r = e.files.find((e) => e.path === "SKILL.md");
		r || Y("Each skill package must include SKILL.md.");
		let i;
		try {
			i = Sf(xf(Ap(r.content).toString("utf8")).data, "name") ?? e.directory;
		} catch {
			Y("A bundled SKILL.md has invalid frontmatter.");
		}
		i !== e.name && Y("A bundled skill name does not match its SKILL.md or directory.");
	}
	if (o.size !== a.size && Y("The bundle is missing a referenced skill package."), r.version === 2) {
		let e = r.chain.agent;
		if (e === void 0 != (r.agents.length === 0) && Y("The bundle agent inventory does not match the selected native agent."), e !== void 0) {
			let t = r.agents[0];
			t !== void 0 && t.name === e.name && t.harness === e.harness && t.agentPath === e.agentPath && t.fingerprint === e.fingerprint && Fp(t.agentPath, t.harness) || Y("The bundled native agent does not match the chain selection.");
			let n = Ap(t.content);
			if (c += n.length, l += 1, c > 20971520 || l > 2e3) throw new Cp("BUNDLE_TOO_LARGE", "Bundles are limited to 20 MiB and 2,000 files.");
			d("sha256").update(n).digest("hex") !== t.fingerprint && Y("The bundled native agent fingerprint does not match its content.");
		}
	}
	return r;
}
function Pp(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
function Fp(e, t) {
	let n = e.split("/");
	return e.startsWith("/") || e.includes("\\") || n.some((e) => e === "" || e === "." || e === ".." || !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(e) || /[. ]$/.test(e) || wp.test(e) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(e)) ? !1 : t === "opencode" ? e.endsWith(".md") : e.endsWith(".agent.md");
}
// src/shared/project-claim.ts
var Ip = "project-claim.sqlite", Lp = 1280266061, Rp = 2, zp = Lp, Bp = 8388608, Vp = 1048576, Hp = "CREATE TABLE claim (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)", Up = "CREATE TABLE protocol (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)", Wp = "CREATE TABLE lifecycle (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)", Gp = I({
	version: R(1),
	projectPath: N(),
	projectDevice: N().regex(/^[0-9]+$/),
	projectInode: N().regex(/^[0-9]+$/),
	enabledAt: z({ offset: !0 })
}), Kp = I({
	version: R(1),
	projectPath: N(),
	projectDevice: N().regex(/^[0-9]+$/),
	projectInode: N().regex(/^[0-9]+$/),
	retiredAt: z({ offset: !0 })
}), qp = I({
	version: R(1),
	projectPath: N().refine((e) => i(e) && !e.includes("\0")),
	projectDevice: N().regex(/^[0-9]+$/),
	projectInode: N().regex(/^[0-9]+$/),
	kind: L(["managed", "portable"]),
	runId: N().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	createdAt: z({ offset: !0 })
}).refine((e) => e.kind !== "portable" || /^[a-f0-9-]{36}$/.test(e.runId)), X = class extends Error {
	code;
	constructor(e, t, n) {
		super(t, n), this.code = e, this.name = "ProjectClaimError";
	}
}, Jp = /* @__PURE__ */ new Map();
function Yp(e, t) {
	return e instanceof Error && "code" in e && e.code === t;
}
function Z(e, t) {
	return new X("PROJECT_CLAIM_UNSAFE", e, t === void 0 ? void 0 : { cause: t });
}
async function Xp(t) {
	if (!i(t) || t.includes("\0")) throw Z("The project path must be absolute.");
	let n = await v(t), r = await b(n, { bigint: !0 });
	if (!r.isDirectory()) throw Z("The project is not a directory.");
	let o = a(n, ".loom");
	try {
		await h(o, { mode: 448 });
	} catch (e) {
		if (!Yp(e, "EEXIST")) throw e;
	}
	let c = await m(o);
	if (!c.isDirectory() || c.isSymbolicLink() || await v(o) !== o) throw Z("The project coordination directory is unsafe.");
	await Zp(o);
	let l = a(o, Ip);
	try {
		await m(l);
	} catch (t) {
		if (!Yp(t, "ENOENT")) throw Z("The project claim database could not be inspected.", t);
		let n = `${l}.${f()}.tmp`;
		await (await g(n, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_NOFOLLOW, 384)).close();
		try {
			let e = new te(n);
			try {
				e.exec(`PRAGMA synchronous = FULL; BEGIN EXCLUSIVE; ${Hp}; ${Up}; ${Wp}; PRAGMA user_version = ${Rp}; PRAGMA application_id = ${zp}; COMMIT`);
			} finally {
				e.close();
			}
			try {
				await p(n, l), await Qp(o);
			} catch (e) {
				if (!Yp(e, "EEXIST")) throw e;
			}
		} finally {
			await x(n);
		}
		await Qp(o);
	}
	let u = await m(l);
	for (let e = 0; u.nlink !== 1 && e < 10; e++) await new Promise((e) => setTimeout(e, 10)), u = await m(l);
	if (!u.isFile() || u.isSymbolicLink() || u.nlink !== 1 || u.size > Bp || s(await v(l)) !== l) throw Z("The project claim database is unsafe.");
	for (let e of [
		"-journal",
		"-wal",
		"-shm"
	]) try {
		let t = await m(l + e);
		if (!t.isFile() || t.isSymbolicLink() || t.nlink !== 1 || t.size > Bp) throw Z("A project claim database sidecar is unsafe.");
	} catch (e) {
		if (!Yp(e, "ENOENT")) throw e;
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
async function Zp(t) {
	let n;
	try {
		n = await g(a(t, ".gitignore"), e.O_RDWR | e.O_CREAT | e.O_APPEND | e.O_NOFOLLOW, 384);
		let r = await n.stat();
		if (!r.isFile() || r.nlink !== 1 || r.size > Vp) throw Z("The project ignore file is unsafe.");
		let i = await n.readFile("utf8");
		i.split(/\r?\n/).filter((e) => e !== "").at(-1) !== `${Ip}*` && (await n.writeFile(`${i === "" || i.endsWith("\n") ? "" : "\n"}${Ip}*\n`, "utf8"), await n.sync(), await Qp(t));
	} catch (e) {
		throw e instanceof X ? e : Z("The project ignore file could not be updated.", e);
	} finally {
		await n?.close();
	}
}
async function Qp(t) {
	let n = await g(t, e.O_RDONLY);
	try {
		try {
			await n.sync();
		} catch (e) {
			if (!Yp(e, "EINVAL") && !Yp(e, "EISDIR") && !Yp(e, "EPERM") && !Yp(e, "ENOTSUP")) throw e;
		}
	} finally {
		await n.close();
	}
}
function $p(e, t) {
	if (typeof e != "string" || Buffer.byteLength(e, "utf8") > 4096) throw Z("The project claim is invalid.");
	let n;
	try {
		n = JSON.parse(e);
	} catch (e) {
		throw Z("The project claim is invalid.", e);
	}
	let r = qp.safeParse(n);
	if (!r.success || r.data.projectPath !== t.projectPath || r.data.projectDevice !== t.projectDevice || r.data.projectInode !== t.projectInode) throw Z("The project claim is invalid or belongs to another project.");
	return r.data;
}
async function em(e, t) {
	return tm(e, t, !1);
}
async function tm(e, t, n) {
	if (!i(e) || e.includes("\0")) throw Z("The project path must be absolute.");
	let r;
	try {
		r = await v(e);
	} catch (e) {
		throw Z("The project coordination path could not be resolved.", e);
	}
	let a = (Jp.get(r) ?? Promise.resolve()).then(async () => {
		let e, i;
		try {
			({identity: e, path: i} = await Xp(r));
		} catch (e) {
			throw e instanceof X ? e : Z("The project claim database could not be prepared.", e);
		}
		let a, o = !1, s = !0, c = !1;
		try {
			a = new te(i), a.exec("PRAGMA busy_timeout = 0; PRAGMA synchronous = FULL; BEGIN EXCLUSIVE"), o = !0;
			let r = a.prepare("PRAGMA user_version").get()?.user_version;
			if (r !== 1 && r !== Rp) throw Z("The project claim database has an unsupported or incomplete version.");
			if (a.prepare("PRAGMA application_id").get()?.application_id !== zp) throw Z("The project claim database identity is invalid.");
			if (a.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete") throw Z("The project claim database journal mode is unsupported.");
			let l = a.prepare("SELECT type, name, sql FROM sqlite_master").all();
			if (l.length !== (r === 1 ? 2 : 3) || !l.some((e) => e.type === "table" && e.name === "claim" && e.sql === Hp) || !l.some((e) => e.type === "table" && e.name === "protocol" && e.sql === Up) || r === Rp && !l.some((e) => e.type === "table" && e.name === "lifecycle" && e.sql === Wp)) throw Z("The project claim database schema is invalid.");
			if (a.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") throw Z("The project claim database is corrupt.");
			r === 1 && a.exec(`${Wp}; PRAGMA user_version = ${Rp}`);
			let u = a, d = () => {
				if (!s) throw Z("The project claim transaction is no longer active.");
				let t = u.prepare("SELECT id, document FROM claim").all();
				if (t.length === 0) return null;
				if (t.length !== 1 || t[0]?.id !== 1) throw Z("The project claim database contains invalid rows.");
				return $p(t[0].document, e);
			}, f = () => {
				if (!s) throw Z("The project claim transaction is no longer active.");
				let t = u.prepare("SELECT id, document FROM protocol").all();
				if (t.length === 0) return null;
				if (t.length !== 1 || t[0]?.id !== 1 || typeof t[0].document != "string" || Buffer.byteLength(t[0].document, "utf8") > 4096) throw Z("The project protocol record is invalid.");
				let n;
				try {
					n = JSON.parse(t[0].document);
				} catch (e) {
					throw Z("The project protocol record is invalid.", e);
				}
				let r = Gp.safeParse(n);
				if (!r.success || r.data.projectPath !== e.projectPath || r.data.projectDevice !== e.projectDevice || r.data.projectInode !== e.projectInode) throw Z("The project protocol record is invalid or belongs to another project.");
				return r.data;
			}, p = () => {
				if (!s) throw Z("The project claim transaction is no longer active.");
				let t = u.prepare("SELECT id, document FROM lifecycle").all();
				if (t.length === 0) return !1;
				if (t.length !== 1 || t[0]?.id !== 1 || typeof t[0].document != "string" || Buffer.byteLength(t[0].document, "utf8") > 4096) throw Z("The project retirement record is invalid.");
				let n;
				try {
					n = JSON.parse(t[0].document);
				} catch (e) {
					throw Z("The project retirement record is invalid.", e);
				}
				let r = Kp.safeParse(n);
				if (!r.success || r.data.projectPath !== e.projectPath || r.data.projectDevice !== e.projectDevice || r.data.projectInode !== e.projectInode) throw Z("The project retirement record is invalid or belongs to another project.");
				return !0;
			}, m = () => {
				if (p()) throw new X("PROJECT_CLAIM_RETIRED", "This workspace is being removed and cannot start or change runs.");
			}, h = {
				identity: e,
				protocol: f,
				enableProtocol(t) {
					if (m(), f() !== null) return;
					let n = Gp.safeParse({
						version: 1,
						...e,
						enabledAt: t
					});
					if (!n.success) throw Z("The project protocol record is invalid.");
					u.prepare("INSERT INTO protocol (id, document) VALUES (1, ?)").run(JSON.stringify(n.data));
				},
				read: d,
				acquire(t) {
					m();
					let n = qp.safeParse(t);
					if (!n.success || n.data.projectPath !== e.projectPath || n.data.projectDevice !== e.projectDevice || n.data.projectInode !== e.projectInode) throw Z("The new project claim is invalid.");
					if (d() !== null) throw new X("PROJECT_CLAIM_CONFLICT", "Another operation already claims this project.");
					u.prepare("INSERT INTO claim (id, document) VALUES (1, ?)").run(JSON.stringify(n.data));
				},
				release(e) {
					m();
					let t = d();
					if (t === null || t.kind !== e.kind || t.runId !== e.runId) throw new X("PROJECT_CLAIM_MISMATCH", "The project claim does not match this run.");
					u.prepare("DELETE FROM claim WHERE id = 1").run();
				},
				retired: p,
				retire(t) {
					if (p()) return;
					if (d() !== null) throw new X("PROJECT_CLAIM_CONFLICT", "A claimed project cannot be retired.");
					let n = Kp.safeParse({
						version: 1,
						...e,
						retiredAt: t
					});
					if (!n.success) throw Z("The project retirement record is invalid.");
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
			throw c || e instanceof X ? e : typeof e == "object" && e && "errcode" in e && typeof e.errcode == "number" && (e.errcode & 255) == 5 ? new X("PROJECT_CLAIM_BUSY", "Another process is updating the project claim.", { cause: e }) : Z("The project claim transaction failed.", e);
		} finally {
			a?.close();
		}
	}), o = a.then(() => void 0, () => void 0);
	return Jp.set(r, o), o.then(() => {
		Jp.get(r) === o && Jp.delete(r);
	}), a;
}
var nm = 8192, rm = 1e3, im = /^[a-f0-9-]{36}$/, am = ac(N().regex(/^[A-Za-z][A-Za-z0-9_]*$/), N().max(16384)), om = I({
	number: Vs().int().positive(),
	status: L([
		"running",
		"done",
		"failed",
		"skipped",
		"interrupted"
	]),
	startedAt: z({ offset: !0 }),
	finishedAt: z({ offset: !0 }).nullable(),
	summary: N().max(nm).nullable(),
	reason: N().max(2e3).nullable()
}), sm = I({
	version: R(1),
	id: N().regex(im),
	revision: Vs().int().positive(),
	projectPath: N().min(1),
	bundleFingerprint: N().regex(/^[a-f0-9]{64}$/),
	bundle: kc((e) => {
		try {
			return Np(e), !0;
		} catch {
			return !1;
		}
	}),
	actualHost: L([
		"copilot",
		"opencode",
		"other"
	]),
	hostSwitchConfirmed: Gs(),
	progression: L(["supervised", "agent"]),
	progressionConfirmed: Gs(),
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
		confirmed: Gs()
	}),
	resolvedInputs: am,
	skillFingerprintVersion: R(2).optional(),
	installedSkills: F(I({
		name: N(),
		directory: N(),
		fingerprint: N().regex(/^[a-f0-9]{64}$/),
		reused: Gs()
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
	currentStepIndex: Vs().int().min(0),
	resumeRequired: Gs(),
	steps: F(I({
		id: N().min(1),
		index: Vs().int().min(0),
		attempts: F(om).max(50)
	})).min(1).max(rm),
	createdAt: z({ offset: !0 }),
	updatedAt: z({ offset: !0 })
});
function cm(e, t, n) {
	let r = sm.safeParse(e);
	if (!r.success || r.data.projectPath !== t || r.data.id !== n) return null;
	let i = Np(r.data.bundle);
	return d("sha256").update(JSON.stringify(i)).digest("hex") !== r.data.bundleFingerprint || i.chain.steps.length !== r.data.steps.length || i.chain.steps.some((e, t) => r.data.steps[t]?.id !== e.id) ? null : r.data;
}
var lm = L(["supervised", "automatic"]), um = L([
	"starting",
	"running",
	"awaiting-user",
	"paused",
	"failed",
	"completed",
	"aborted",
	"interrupted"
]), dm = L([
	"pending",
	"running",
	"done",
	"failed",
	"skipped",
	"interrupted"
]), fm = L([
	"none",
	"native",
	"handoff"
]), pm = L([
	"unknown",
	"not-observable",
	"observed",
	"not-observed"
]), mm = 32768, hm = 2e3, gm = N().trim().min(1), _m = z({ offset: !0 }), vm = N().max(hm).nullable().default(null);
ac(N(), N().nullable());
var ym = N().refine(Mm, { message: `A step tail must be at most 200 lines and ${String(mm)} bytes.` }).default(""), bm = {
	id: gm,
	index: Vs().int().min(0),
	label: gm.nullable().default(null),
	status: dm,
	startedAt: _m.nullable().default(null),
	finishedAt: _m.nullable().default(null),
	exitCode: Vs().int().nullable().default(null),
	sessionId: gm.nullable().default(null),
	forkMechanism: fm,
	skillObservation: pm.default("unknown"),
	tail: ym,
	reason: vm
}, xm = tc("kind", [I({
	...bm,
	kind: R("skill").optional(),
	skillName: gm
}), I({
	...bm,
	kind: R("instruction"),
	skillName: Ys().optional()
})]), Sm = I({
	version: R(1),
	id: gm,
	projectId: gm,
	chainId: gm,
	harness: L(Ef),
	mode: lm,
	sessionMode: Gf,
	chainSnapshot: J,
	resolvedInputs: ac(N(), N()).default({}),
	status: um,
	currentStepIndex: Vs().int().min(0),
	createdAt: _m,
	updatedAt: _m,
	startedAt: _m.nullable().default(null),
	finishedAt: _m.nullable().default(null),
	sessionId: gm.nullable().default(null),
	forkMechanism: fm,
	steps: F(xm).min(1),
	reason: vm
}), Cm = {
	STEP_COUNT_MISMATCH: "run_step_count_mismatch",
	STEP_ID_MISMATCH: "run_step_id_mismatch",
	STEP_INDEX_MISMATCH: "run_step_index_mismatch",
	STEP_SKILL_MISMATCH: "run_step_skill_mismatch",
	CURRENT_STEP_OUT_OF_RANGE: "run_current_step_out_of_range",
	INPUT_UNDECLARED: "run_input_undeclared",
	INPUT_REQUIRED: "run_input_required",
	TAIL_TOO_LARGE: "run_tail_too_large"
}, wm = class extends Error {
	code;
	details;
	constructor(e, t, n = {}, r = {}) {
		super(t, r.cause === void 0 ? void 0 : { cause: r.cause }), this.name = new.target.name, this.code = e, this.details = n;
	}
}, Tm = class extends wm {
	issues;
	constructor(e) {
		super("RUN_INVALID", "The run record is not valid.", { issues: e }), this.issues = e;
	}
}, Em = class extends wm {
	constructor(e) {
		super("RUN_UNSUPPORTED_VERSION", "The run uses an unsupported version.", {
			version: Fm(e),
			supportedVersion: 1
		});
	}
};
function Dm(e) {
	if (!Pm(e)) return e;
	let t = e.chainSnapshot;
	return {
		...e,
		...Object.hasOwn(e, "version") ? {} : { version: 1 },
		...t === void 0 ? {} : { chainSnapshot: lp(t) }
	};
}
function Om(e) {
	if (Pm(e) && Object.hasOwn(e, "version") && e.version !== 1) throw new Em(e.version);
	return km(Dm(e));
}
function km(e) {
	let t = Sm.safeParse(e);
	if (!t.success) throw new Tm(Nm(t.error.issues));
	let n = t.data, r = [], i = n.chainSnapshot.steps;
	n.steps.length !== i.length && r.push({
		path: "steps",
		code: Cm.STEP_COUNT_MISMATCH,
		message: `The run has ${String(n.steps.length)} step records for ${String(i.length)} snapshot steps.`
	}), n.steps.forEach((e, t) => {
		let n = i[t];
		n !== void 0 && (e.index !== t && r.push({
			path: `steps.${String(t)}.index`,
			code: Cm.STEP_INDEX_MISMATCH,
			stepId: e.id,
			stepIndex: t,
			message: `Step record ${String(t)} records index ${String(e.index)}.`
		}), e.id !== n.id && r.push({
			path: `steps.${String(t)}.id`,
			code: Cm.STEP_ID_MISMATCH,
			stepId: e.id,
			stepIndex: t,
			message: `Step record ${String(t)} does not match the frozen snapshot step id.`
		}), (e.skillName !== n.skillName || e.kind === "instruction" != (n.kind === "instruction")) && r.push({
			path: `steps.${String(t)}.skillName`,
			code: Cm.STEP_SKILL_MISMATCH,
			stepId: e.id,
			stepIndex: t,
			message: `Step record ${String(t)} does not match the frozen snapshot skill.`
		}), Mm(e.tail) || r.push({
			path: `steps.${String(t)}.tail`,
			code: Cm.TAIL_TOO_LARGE,
			stepId: e.id,
			stepIndex: t,
			message: `The step tail exceeds 200 lines or ${String(mm)} bytes.`
		}));
	}), (n.currentStepIndex < 0 || n.currentStepIndex >= n.steps.length) && r.push({
		path: "currentStepIndex",
		code: Cm.CURRENT_STEP_OUT_OF_RANGE,
		message: "The current step index is outside the frozen step list."
	});
	let a = new Map(n.chainSnapshot.inputs.map((e) => [e.name, e]));
	for (let e of Object.keys(n.resolvedInputs)) a.has(e) || r.push({
		path: `resolvedInputs.${e}`,
		code: Cm.INPUT_UNDECLARED,
		inputName: e,
		message: `Resolved input "${e}" is not declared by the frozen chain.`
	});
	for (let e of n.chainSnapshot.inputs) {
		let t = n.resolvedInputs[e.name] ?? "";
		e.required && t.trim() === "" && r.push({
			path: `resolvedInputs.${e.name}`,
			code: Cm.INPUT_REQUIRED,
			inputName: e.name,
			message: `Required input "${e.name}" is unresolved.`
		});
	}
	if (r.length > 0) throw new Tm(r);
	return n;
}
function Am(e) {
	return e === "" ? 0 : e.split("\n").length;
}
function jm(e) {
	return Buffer.byteLength(e, "utf8");
}
function Mm(e) {
	return Am(e) <= 200 && jm(e) <= 32768;
}
function Nm(e) {
	return e.map((e) => ({
		path: e.path.map((e) => String(e)).join("."),
		code: e.code,
		message: e.message
	}));
}
function Pm(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
function Fm(e) {
	return e === null || [
		"string",
		"number",
		"boolean"
	].includes(typeof e) ? e : Array.isArray(e) ? "array" : typeof e;
}
// src/shared/project-run-records.ts
var Im = 1e3, Lm = 67108864, Rm = 31457280, zm = /^[a-z0-9][a-z0-9_-]{0,63}$/, Bm = class extends Error {
	code = "PROJECT_RUN_RECORDS_UNSAFE";
	constructor(e, t) {
		super(e, t), this.name = "ProjectRunRecordsError";
	}
};
function Vm(e) {
	return e instanceof Error && "code" in e && e.code === "ENOENT";
}
async function Hm(t, n) {
	let r = await g(t, e.O_RDONLY | e.O_NOFOLLOW | e.O_NONBLOCK);
	try {
		let e = await r.stat({ bigint: !0 }), t = Math.min(Rm, n);
		if (!e.isFile() || e.nlink !== 1n || e.size > BigInt(t)) throw new Bm("A project run record is unsafe or exceeds the scan budget.");
		let i = Buffer.alloc(Number(e.size)), a = 0;
		for (; a < i.length;) {
			let { bytesRead: e } = await r.read(i, a, i.length - a, a);
			if (e === 0) throw new Bm("A project run record changed during inspection.");
			a += e;
		}
		let o = await r.stat({ bigint: !0 });
		if (e.dev !== o.dev || e.ino !== o.ino || e.size !== o.size || e.mtimeNs !== o.mtimeNs || e.ctimeNs !== o.ctimeNs) throw new Bm("A project run record changed during inspection.");
		let s = new TextDecoder("utf-8", { fatal: !0 }).decode(i);
		return {
			document: JSON.parse(s),
			bytes: i.length,
			fingerprint: d("sha256").update(i).digest("hex")
		};
	} finally {
		await r.close();
	}
}
async function Um(e) {
	let t = [], n = 0;
	for (let r of ["managed", "portable"]) {
		let i = a(e, ".loom", r === "managed" ? "runs" : "portable-runs"), o;
		try {
			o = await m(i);
		} catch (e) {
			if (Vm(e)) continue;
			throw new Bm("The project run directory could not be inspected.", { cause: e });
		}
		if (!o.isDirectory() || o.isSymbolicLink() || await v(i) !== i) throw new Bm("The project run directory is unsafe.");
		let s = await _(i);
		for await (let o of s) {
			if (!o.name.endsWith(".json")) continue;
			let s = o.name.slice(0, -5);
			if (!(r === "managed" ? zm : im).test(s)) throw new Bm("A project run record has an invalid name.");
			if (t.length >= Im) throw new Bm("The project run record count exceeds the scan budget.");
			try {
				let c = await Hm(a(i, o.name), Lm - n);
				if (n += c.bytes, r === "managed") {
					let e = Om(c.document);
					if (e.id !== s) throw new Bm("A project run record id does not match its filename.");
					t.push({
						kind: r,
						runId: s,
						status: e.status,
						fingerprint: c.fingerprint,
						unresolved: e.status !== "completed" && e.status !== "aborted" || e.steps.some((e) => e.status === "running")
					});
				} else {
					let n = cm(c.document, e, s);
					if (n === null) throw new Bm("A portable run record is invalid.");
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
				throw e instanceof Bm ? e : new Bm("A project run record could not be validated.", { cause: e });
			}
		}
	}
	return t.sort((e, t) => e.kind.localeCompare(t.kind) || e.runId.localeCompare(t.runId));
}
// src/shared/project-coordination.ts
var Wm = class extends Error {
	code;
	records;
	constructor(e, t = []) {
		super(e === "PROJECT_PROTOCOL_NOT_ENABLED" ? "Review and enable coordinated project execution before starting a run." : e === "PROJECT_REVIEW_STALE" ? "Project coordination evidence changed; review it again." : e === "PROJECT_CONFIRMATION_REQUIRED" ? "Confirm that prior work, processes, and older clients have stopped." : "Existing project runs have unresolved ownership and require explicit reconciliation."), this.code = e, this.records = t, this.name = "ProjectCoordinationError";
	}
};
async function Gm(e, t, n, r = !1) {
	let i = performance.now() + 1e3;
	for (;;) {
		let a = !1;
		try {
			return await em(e, async (e) => {
				if (a = !0, e.protocol() === null) throw new Wm("PROJECT_PROTOCOL_NOT_ENABLED");
				let r = e.read();
				if (r === null || r.kind !== t.kind || r.runId !== t.runId) throw new X("PROJECT_CLAIM_MISMATCH", "The project claim does not match this run.");
				return n(r);
			});
		} catch (e) {
			let t = i - performance.now();
			if (!r || a || !(e instanceof X) || e.code !== "PROJECT_CLAIM_BUSY" || t <= 0) throw e;
			await new Promise((e) => setTimeout(e, Math.min(25, t)));
		}
	}
}
async function Km(e, t, n, r, i = /* @__PURE__ */ new Date()) {
	let a = await em(e, async (e) => {
		if (e.read() !== null) throw new X("PROJECT_CLAIM_CONFLICT", "Another operation already claims this project.");
		if (e.protocol() === null) return {
			kind: "legacy",
			value: await r()
		};
		let a = (await Um(e.identity.projectPath)).filter((e) => e.unresolved);
		if (a.length > 0) throw new Wm("PROJECT_RECONCILIATION_REQUIRED", a);
		return e.acquire({
			version: 1,
			...e.identity,
			kind: t,
			runId: n,
			createdAt: i.toISOString()
		}), { kind: "claimed" };
	});
	return a.kind === "legacy" ? a.value : Gm(e, {
		kind: t,
		runId: n
	}, r, !0);
}
async function qm(e, t, n) {
	return em(e, async (e) => {
		let r = e.protocol(), i = e.read();
		if (r !== null) {
			if (i === null || i.kind !== t.kind || i.runId !== t.runId) throw new X("PROJECT_CLAIM_MISMATCH", "The project claim does not match this run.");
		} else if (i !== null) throw new X("PROJECT_CLAIM_CONFLICT", "Another operation already claims this project.");
		return n(i);
	});
}
// src/portable/install-skill.ts
async function Jm(t, n, i = { directoryMode: 448 }) {
	if (!n.some((e) => e.path === "SKILL.md")) throw new Cp("BUNDLE_INVALID", "Each skill package must include SKILL.md.");
	for (let e of n) kp(e.path);
	async function s(e) {
		let n = t;
		for (let s of o(t, r(e)).split(c).filter(Boolean)) {
			n = a(n, s);
			try {
				await h(n, { mode: i.directoryMode });
			} catch (e) {
				if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
			}
			let e = await m(n);
			if (!e.isDirectory() || e.isSymbolicLink() || await v(n) !== n) throw new Cp("BUNDLE_SOURCE_UNAVAILABLE", "A skill package directory changed during installation.");
		}
	}
	async function l(t, n) {
		let r = await g(t, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_NOFOLLOW, n.executable ? 493 : 420);
		try {
			await r.writeFile(Ap(n.content)), i.enforceFileMode && await r.chmod(n.executable ? 493 : 420), await r.sync();
		} finally {
			await r.close();
		}
	}
	let u = n.filter((e) => e.path.split("/").at(-1) === "SKILL.md");
	for (let e of n) {
		if (e.path.split("/").at(-1) === "SKILL.md") continue;
		let n = a(t, ...e.path.split("/"));
		await s(n), await l(n, e);
	}
	u.sort((e, t) => t.path.split("/").length - e.path.split("/").length);
	for (let e of u) {
		let n = a(t, ...e.path.split("/"));
		await s(n), await Ym(r(n), Ap(e.content), e.executable ? 493 : 420, {
			...i,
			temporaryRoot: r(t)
		});
	}
}
async function Ym(t, n, i, o = {}) {
	let s = a(o.temporaryRoot ?? r(t), `.loom-skill-${f()}.tmp`), c = !1;
	try {
		let r = await g(s, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_NOFOLLOW, i);
		c = !0;
		try {
			await r.writeFile(n), o.enforceFileMode && await r.chmod(i), await r.sync();
		} finally {
			await r.close();
		}
		await (o.publish ?? p)(s, a(t, "SKILL.md"));
	} finally {
		c && await x(s);
	}
}
// src/portable/runtime.ts
var Xm = 65536, Zm = 1048576, Qm = 1e3, $m = 67108864, eh = class extends Error {
	code;
	constructor(e, t) {
		super(t), this.code = e, this.name = "PortableRunError";
	}
};
function Q(e, t) {
	throw new eh(e, t);
}
function $() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function th(e) {
	return d("sha256").update(e).digest("hex");
}
function nh() {
	return d("sha256").update("skill-loom-installed-tree-v2\0");
}
function rh(e, t, n) {
	let r = Buffer.from(t, "utf8"), i = (e) => {
		let t = Buffer.alloc(8);
		return t.writeBigUInt64BE(BigInt(e)), t;
	};
	e.update(n === void 0 ? "d" : "f").update(i(r.length)).update(r), n !== void 0 && e.update(n.executable ? "" : "\0").update(i(n.content.byteLength)).update(n.content);
}
function ih(e) {
	let t = nh(), r = /* @__PURE__ */ new Set(), i = new Map(e.map((e) => [e.path, e]));
	for (let t of e) {
		let e = t.path.split("/");
		for (e.pop(); e.length > 0;) r.add(e.join("/")), e.pop();
	}
	function a(e) {
		let o = /* @__PURE__ */ new Set();
		for (let t of r) ah(t) === e && o.add(t);
		for (let t of i.keys()) ah(t) === e && o.add(t);
		for (let e of [...o].sort((e, t) => n(e).localeCompare(n(t)))) if (r.has(e)) rh(t, e), a(e);
		else {
			let n = i.get(e);
			rh(t, e, {
				executable: n.executable,
				content: Ap(n.content)
			});
		}
	}
	return a(""), t.digest("hex");
}
function ah(e) {
	let t = e.lastIndexOf("/");
	return t < 0 ? "" : e.slice(0, t);
}
function oh(e, t) {
	let n = am.safeParse(t ?? {});
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
function sh(e, t, n) {
	let r = e.chain.steps[t];
	r || Q("STEP_NOT_FOUND", "No active chain step exists.");
	let i = r.instruction.replace(/\{\{([^{}]*)\}\}/g, (e, t) => {
		let r = t.trim();
		return Object.hasOwn(n, r) || Q("INPUT_UNRESOLVED", `Input "${r}" has no resolved value.`), n[r];
	});
	return r.kind === "instruction" ? `Instruction:\n${i}` : `Skill: ${r.skillName}\n\nInstruction:\n${i}`;
}
async function ch(e) {
	try {
		await h(e, { mode: 448 });
	} catch (e) {
		if (!lh(e, "EEXIST")) throw e;
	}
	let t = await m(e);
	(!t.isDirectory() || t.isSymbolicLink() || await v(e) !== e) && Q("PATH_UNSAFE", "A required directory is not a real directory.");
}
function lh(e, t) {
	return e instanceof Error && "code" in e && e.code === t;
}
async function uh(e) {
	i(e) || Q("PROJECT_INVALID", "The project path must be absolute.");
	let t = await v(e);
	return (await b(t)).isDirectory() || Q("PROJECT_INVALID", "The project path is not a directory."), t;
}
async function dh(e) {
	let t = a(e, ".agents"), n = a(t, "skills");
	return await ch(t), await ch(n), n;
}
async function fh(t, n, r) {
	let i = await m(t, { bigint: !0 });
	(!i.isFile() || i.isSymbolicLink() || i.ino === 0n) && Q(n, "The file must be a regular file with a verifiable identity, not a symbolic link.");
	let a;
	try {
		a = await g(t, e.O_RDONLY | e.O_NOFOLLOW | e.O_NONBLOCK);
	} catch (e) {
		throw lh(e, "ELOOP") && Q(n, "The file must not be a symbolic link."), e;
	}
	let o = (e) => e.dev === i.dev && e.ino === i.ino, s = async () => {
		let e;
		try {
			e = await m(t, { bigint: !0 });
		} catch (e) {
			throw lh(e, "ENOENT") && Q(r, "The file changed while it was inspected. Review it again."), e;
		}
		e.isFile() && !e.isSymbolicLink() && o(e) || Q(r, "The file changed while it was inspected. Review it again.");
	};
	try {
		let e = await a.stat({ bigint: !0 });
		return e.isFile() && o(e) || Q(r, "The file changed while it was opened. Review it again."), await s(), {
			handle: a,
			verifyPath: s
		};
	} catch (e) {
		throw await a.close(), e;
	}
}
async function ph(e, t) {
	let { handle: n, verifyPath: r } = await fh(e, "PACKAGE_UNSAFE", "PACKAGE_CHANGED");
	try {
		let e = await n.stat();
		(!e.isFile() || e.size > t) && Q("PACKAGE_TOO_LARGE", "An existing package file is unsafe or exceeds the portable review limit.");
		let i = Buffer.alloc(e.size + 1), a = 0;
		for (; a < i.length;) {
			let { bytesRead: e } = await n.read(i, a, i.length - a, a);
			if (e === 0) break;
			a += e;
		}
		let o = await n.stat();
		return (a !== e.size || o.size !== e.size || o.mtimeMs !== e.mtimeMs || o.mode !== e.mode) && Q("PACKAGE_CHANGED", "An existing package changed while it was inspected. Review it again."), await r(), {
			content: i.subarray(0, a),
			executable: !!(e.mode & 73)
		};
	} finally {
		await n.close();
	}
}
async function mh(e, t, n = {
	files: xp,
	bytes: bp
}) {
	let r = nh(), i = 0, o = 0, s = 0, c = 0;
	function l(e) {
		t !== void 0 && (c += Buffer.byteLength(JSON.stringify(e), "utf8") + 1, c > (n.inventoryBytes ?? 2 ** 53 - 1) && Q("PACKAGE_TOO_LARGE", "The existing package inventory exceeds the portable review limit."), t.push(e));
	}
	async function u(e, c, d) {
		(d > 32 || await v(e) !== e) && Q("PACKAGE_UNSAFE", "An installed skill has unsafe directories or exceeds the depth limit.");
		let f = [];
		for await (let t of await _(e)) s += 1, s > (n.entries ?? 66e3) && Q("PACKAGE_TOO_LARGE", "The existing package exceeds the portable review entry limit."), f.push(t);
		f.sort((e, t) => e.name.localeCompare(t.name));
		for (let s of f) {
			let f = a(e, s.name), p = c === "" ? s.name : `${c}/${s.name}`, h = await m(f);
			if (h.isSymbolicLink() && Q("PACKAGE_UNSAFE", "An installed skill contains a symbolic link."), h.isDirectory()) rh(r, p), l({
				path: p,
				kind: "directory"
			}), await u(f, p, d + 1);
			else if (h.isFile()) {
				o += 1, o > n.files && Q("PACKAGE_TOO_LARGE", "The existing package exceeds the portable review file limit.");
				let e = await ph(f, n.bytes - i);
				i += e.content.length, rh(r, p, e), t !== void 0 && l({
					path: p,
					kind: "file",
					bytes: e.content.length,
					executable: e.executable,
					fingerprint: th(e.content)
				});
			} else Q("PACKAGE_UNSAFE", "An installed skill contains a special file.");
		}
	}
	return await u(e, "", 0), r.digest("hex");
}
async function hh(e, t, n, r, i) {
	let s = await dh(t), l = new Set(n);
	(l.size !== n.length || [...l].some((t) => !e.skills.some((e) => e.name === t))) && Q("REUSE_INVALID", "Reuse choices must name distinct skills included in the bundle.");
	let u = [], d = [];
	try {
		for (let t of e.skills) {
			let e = a(s, t.directory);
			(o(s, e).startsWith(`..${c}`) || o(s, e) === "..") && Q("PATH_UNSAFE", "A skill destination escapes the project skill directory.");
			let n = !1;
			try {
				await m(e), n = !0;
			} catch (e) {
				if (!lh(e, "ENOENT")) throw e;
			}
			if (n) {
				let n = await m(e);
				n.isDirectory() && !n.isSymbolicLink() && l.has(t.name) || Q("PACKAGE_CONFLICT", `Skill "${t.name}" already exists. Review it and explicitly choose reuse or cancel.`);
				let o = a(e, "SKILL.md"), s = await m(o);
				(!s.isFile() || s.isSymbolicLink()) && Q("PACKAGE_CONFLICT", `Existing "${t.name}" is not a valid skill package.`), (Sf(xf((await ph(o, bp)).content.toString("utf8")).data, "name") ?? t.directory) !== t.name && Q("PACKAGE_CONFLICT", `Existing skill directory does not contain "${t.name}".`);
				let c = await mh(e);
				c !== i.get(t.name) && Q("REVIEW_STALE", `Existing "${t.name}" changed since inspection; inspect and review it again.`), c !== ih(t.files) && !r && Q("REUSE_CONTENT_CONFIRMATION_REQUIRED", `Existing "${t.name}" differs from the bundle; explicitly confirm reuse of its installed contents.`), u.push({
					name: t.name,
					directory: t.directory,
					fingerprint: c,
					reused: !0
				});
			} else i.get(t.name) !== null && Q("REVIEW_STALE", `Existing "${t.name}" changed since inspection; inspect and review it again.`), l.has(t.name) && Q("REUSE_MISSING", `Skill "${t.name}" selected for reuse is missing.`), await h(e, { mode: 493 }), d.push(e), await Jm(e, t.files, {
				directoryMode: 448,
				enforceFileMode: !0
			}), u.push({
				name: t.name,
				directory: t.directory,
				fingerprint: await mh(e),
				reused: !1
			});
		}
		return {
			installedSkills: u,
			createdDirectories: d
		};
	} catch (e) {
		throw await Promise.all(d.map((e) => ee(e, {
			recursive: !0,
			force: !0
		}))), e instanceof eh || e instanceof Cp ? e : new eh("INSTALL_FAILED", "Skill installation failed; newly created package directories were rolled back.");
	}
}
async function gh(t) {
	let n = a(t, ".loom"), r = a(n, "portable-runs");
	await ch(n), await ch(r);
	let i = a(n, ".gitignore");
	try {
		let t = await g(i, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_APPEND | e.O_NOFOLLOW, 384);
		try {
			await t.writeFile("runs/\nportable-runs/\n", "utf8"), await t.sync();
		} finally {
			await t.close();
		}
	} catch (t) {
		if (!lh(t, "EEXIST")) throw t;
		let n = await m(i, { bigint: !0 });
		(!n.isFile() || n.isSymbolicLink() || n.ino === 0n) && Q("PATH_UNSAFE", "The Loom ignore file is not a regular file.");
		let r = await g(i, e.O_RDWR | e.O_APPEND | e.O_NOFOLLOW);
		try {
			let e = await r.stat({ bigint: !0 });
			(!e.isFile() || e.dev !== n.dev || e.ino !== n.ino || e.nlink !== 1n || e.size > BigInt(Zm)) && Q("PATH_UNSAFE", "The Loom ignore file is unsafe or too large.");
			let t = Buffer.alloc(1048577), a = 0;
			for (; a < t.length;) {
				let e = await r.read(t, a, t.length - a, a);
				if (e.bytesRead === 0) break;
				a += e.bytesRead;
			}
			a > Zm && Q("PATH_UNSAFE", "The Loom ignore file is unsafe or too large.");
			let o = t.subarray(0, a).toString("utf8"), s = await m(i, { bigint: !0 });
			(!s.isFile() || s.isSymbolicLink() || s.dev !== e.dev || s.ino !== e.ino) && Q("PATH_UNSAFE", "The Loom ignore file changed during inspection.");
			let c = o.split(/\r?\n/).filter((e) => e !== "" && !e.startsWith("#")), l = c.at(-1) === "portable-runs/" && c.at(-2) === "runs/" ? [] : c.at(-1) === "runs/" ? ["portable-runs/"] : ["runs/", "portable-runs/"];
			if (l.length > 0) {
				let e = `${o.endsWith("\n") || o === "" ? "" : "\n"}${l.join("\n")}\n`;
				(await r.stat({ bigint: !0 })).size + BigInt(Buffer.byteLength(e)) > BigInt(Zm) && Q("PATH_UNSAFE", "The Loom ignore file is unsafe or too large."), await r.writeFile(e, "utf8"), await r.sync();
			}
		} finally {
			await r.close();
		}
	}
	return r;
}
async function _h(e, t, n = !1) {
	return vh(e, `${JSON.stringify(t, null, 2)}\n`, n);
}
async function vh(t, n, i = !1) {
	let o = a(r(t), `.${f()}.tmp`);
	try {
		let a = await g(o, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_NOFOLLOW, 384);
		try {
			await a.writeFile(n, "utf8"), await a.sync();
		} finally {
			await a.close();
		}
		i ? (await p(o, t), await x(o)) : await y(o, t), await yh(r(t));
	} catch (e) {
		throw await ee(o, { force: !0 }), e;
	}
}
async function yh(t) {
	let n = await g(t, e.O_RDONLY);
	try {
		try {
			await n.sync();
		} catch (e) {
			if (!lh(e, "EINVAL") && !lh(e, "EISDIR") && !lh(e, "EPERM") && !lh(e, "ENOTSUP")) throw e;
		}
	} finally {
		await n.close();
	}
}
async function bh(t, n) {
	let r = a(t, ".lock"), i;
	try {
		i = await g(r, e.O_WRONLY | e.O_CREAT | e.O_EXCL | e.O_NOFOLLOW, 384);
	} catch (e) {
		throw lh(e, "EEXIST") && Q("RUN_LOCKED", "Another helper process is mutating portable run state; retry after it exits."), e;
	}
	try {
		return await i.writeFile(`${process.pid}\n`, "utf8"), await i.sync(), await n();
	} finally {
		await i.close(), await ee(r, { force: !0 });
	}
}
async function xh(e, t, r = Sp) {
	let i;
	try {
		({content: i} = await ph(e, r));
	} catch (e) {
		if (!(e instanceof eh)) throw e;
		e.code === "PACKAGE_TOO_LARGE" && r < 31457280 && Q("RUN_SCAN_TOO_LARGE", "Portable run records exceed the conflict scan budget; archive completed records before retrying."), Q("RUN_FILE_INVALID", "The portable run record is unsafe, changed during inspection, or exceeds its size limit.");
	}
	let a;
	try {
		a = JSON.parse(i.toString("utf8"));
	} catch (e) {
		if (!(e instanceof SyntaxError)) throw e;
		Q("RUN_FILE_INVALID", "The portable run record is corrupt, unsupported, or belongs to another project.");
	}
	let o = n(e).slice(0, -5), s = cm(a, t, o);
	return (s === null || n(e) !== `${s.id}.json`) && Q("RUN_FILE_INVALID", "The portable run record is corrupt, unsupported, or belongs to another project."), {
		run: s,
		bytes: i.length
	};
}
async function Sh(e, t) {
	return (await xh(e, t)).run;
}
async function Ch(e, t, n) {
	let r = 0, i = 0, a = await _(e);
	for await (let o of a) {
		if (!o.name.endsWith(".json")) continue;
		let a = o.name.slice(0, -5);
		if (im.test(a) || Q("RUN_FILE_INVALID", "The portable run directory contains an invalid run record name."), a === n) continue;
		r += 1, r > Qm && Q("RUN_SCAN_TOO_LARGE", "Too many portable run records to check for conflicts; archive completed records before retrying.");
		let s = await xh(Th(e, a), t, Math.min(Sp, $m - i));
		i += s.bytes;
		let { run: c } = s, l = c.status === "completed" || c.status === "aborted" || c.status === "failed";
		l && (c.resumeRequired || c.steps.some((e) => e.attempts.some((e) => e.status === "running"))) && Q("RUN_FILE_INVALID", "A finished portable run contains an unresolved attempt."), l || Q("RUN_ACTIVE_CONFLICT", "Another portable run is unfinished; finish or explicitly abort it before continuing.");
	}
}
async function wh(e, t) {
	e.installedSkills.length > 0 && e.skillFingerprintVersion !== 2 && Q("PACKAGE_REVIEW_REQUIRED", "This run uses an older package fingerprint. Abort it and inspect and prepare a new run.");
	for (let n of e.installedSkills) {
		let e = a(t, ".agents", "skills", n.directory), r = await m(e);
		(!r.isDirectory() || r.isSymbolicLink() || await mh(e) !== n.fingerprint) && Q("PACKAGE_CHANGED", `Installed skill "${n.name}" changed since this run was prepared; review it and prepare a new run.`);
	}
}
function Th(e, t) {
	return im.test(t) || Q("RUN_ID_INVALID", "The run id is not safe."), a(e, `${t}.json`);
}
async function Eh(e) {
	return e === void 0 ? {} : ((typeof e != "object" || !e || Array.isArray(e)) && Q("REQUEST_INVALID", "The request must be a JSON object."), e);
}
async function Dh(e, t, n = !1) {
	let r = sm.safeParse(t);
	r.success || Q("RUN_STATE_INVALID", "The portable run transition would produce invalid state."), Buffer.byteLength(JSON.stringify(r.data), "utf8") > 31457280 && Q("RUN_TOO_LARGE", "The portable run record exceeds the 30 MiB safety limit."), await _h(Th(e, t.id), r.data, n);
}
async function Oh(e) {
	e && i(e) || Q("BUNDLE_PATH_INVALID", "Provide an absolute bundle file path.");
	let { handle: t, verifyPath: n } = await fh(e, "BUNDLE_INVALID", "BUNDLE_INVALID");
	try {
		let e = await t.stat();
		(!e.isFile() || e.size > 31457280) && Q("BUNDLE_INVALID", "The bundle is not a regular file or exceeds the size limit.");
		let r = Buffer.alloc(e.size + 1), i = 0;
		for (; i < r.length;) {
			let { bytesRead: e } = await t.read(r, i, r.length - i, i);
			if (e === 0) break;
			i += e;
		}
		let a = await t.stat();
		(i !== e.size || a.size !== e.size || a.mtimeMs !== e.mtimeMs) && Q("BUNDLE_INVALID", "The bundle changed while being read; inspect it again."), await n();
		let o = Np(JSON.parse(r.subarray(0, i).toString("utf8")));
		return o.chain.steps.length > 1e3 && Q("CHAIN_TOO_LARGE", `Portable chains are limited to ${String(rm)} steps.`), o;
	} finally {
		await t.close();
	}
}
async function kh(e, t) {
	let n = [];
	for (let r of e.skills) {
		let e = null;
		if (t !== null) {
			let n = a(t, ".agents", "skills", r.directory);
			try {
				let t = await m(n);
				e = t.isDirectory() && !t.isSymbolicLink() && await v(n) === n ? await mh(n) : "unsafe";
			} catch (e) {
				if (!lh(e, "ENOENT")) throw e;
			}
		}
		n.push({
			name: r.name,
			directory: r.directory,
			files: r.files.map((e) => ({
				path: e.path,
				bytes: Ap(e.content).length,
				executable: e.executable
			})),
			skillMarkdown: Buffer.from(r.files.find((e) => e.path === "SKILL.md").content, "base64").toString("utf8"),
			existingFingerprint: e,
			bundledFingerprint: ih(r.files)
		});
	}
	let r = e.version === 2 ? await Promise.all(e.agents.map(async (e) => {
		let n = null;
		if (t !== null) {
			let r = e.harness === "opencode" ? ".opencode/agents" : ".github/agents", i = a(t, r, e.agentPath);
			try {
				let e = await m(i);
				n = e.isFile() && !e.isSymbolicLink() && await v(i) === i ? th((await ph(i, bp)).content) : "unsafe";
			} catch (e) {
				if (!lh(e, "ENOENT")) throw e;
			}
		}
		return {
			name: e.name,
			harness: e.harness,
			agentPath: e.agentPath,
			fingerprint: e.fingerprint,
			content: Ap(e.content).toString("utf8"),
			existingFingerprint: n
		};
	})) : [], i = th(JSON.stringify(e)), o = null;
	if (t !== null) {
		let e = await b(t, { bigint: !0 });
		e.isDirectory() && await v(t) === t || Q("PROJECT_INVALID", "The inspected project is no longer a canonical directory."), o = th(JSON.stringify({
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
async function Ah(e) {
	if (e.command === "inspect") return kh(await Oh(e.bundlePath), e.projectPath ? await uh(e.projectPath) : null);
	e.projectPath && i(e.projectPath) || Q("PROJECT_INVALID", "Provide an absolute project path.");
	let t = await uh(e.projectPath), n = await Eh(e.input);
	if (e.command === "prepare") {
		e.bundlePath && i(e.bundlePath) || Q("BUNDLE_PATH_INVALID", "Provide an absolute bundle file path."), n.installConfirmed !== !0 && Q("INSTALL_CONFIRMATION_REQUIRED", "Review and explicitly confirm package installation first."), typeof n.reviewDigest == "string" && /^[a-f0-9]{64}$/.test(n.reviewDigest) || Q("REVIEW_REQUIRED", "Inspect the bundle and project, then provide the review digest with installation approval.");
		let r = await Oh(e.bundlePath), a = Mp(r);
		a.agent !== void 0 && Q("NATIVE_AGENT_REQUIRES_LOOM", "This bundle selects a harness-native agent. The portable current-conversation runner cannot switch agents; import the bundle into Skill Loom to run it with the selected agent.");
		let o = oh(r, n.inputs);
		for (let e = 0; e < r.chain.steps.length; e += 1) Buffer.byteLength(sh(r, e, o), "utf8") > Xm && Q("INSTRUCTION_TOO_LARGE", "Resolved step instructions are limited to 64 KiB.");
		let s = n.progression === "agent" ? "agent" : n.progression === "supervised" ? "supervised" : null;
		s === null && Q("PROGRESSION_INVALID", "Choose supervised or agent progression."), s === "agent" && n.progressionConfirmed !== !0 && Q("PROGRESSION_CONFIRMATION_REQUIRED", "Agent-driven progression needs explicit consent.");
		let c = n.actualHost === "copilot" || n.actualHost === "opencode" || n.actualHost === "other" ? n.actualHost : null;
		c === null && Q("HOST_INVALID", "Identify the current host as copilot, opencode, or other.");
		let l = n.hostSwitchConfirmed === !0;
		r.chain.harness !== c && !l && Q("HOST_SWITCH_CONFIRMATION_REQUIRED", "The current host differs from the bundle harness; explicitly confirm compatibility review.");
		let u = n.sessionDecision;
		(typeof u != "object" || !u || Array.isArray(u)) && Q("SESSION_DECISION_REQUIRED", "Describe the verified host session mechanism before preparation.");
		let d = u, p = sm.shape.sessionDecision.safeParse(d);
		p.success && p.data.requested === r.chain.sessionMode || Q("SESSION_DECISION_INVALID", "The session decision must match the bundle and name an actual host mechanism."), (r.chain.sessionMode === "fresh" && p.data.mechanism === "current-conversation" || r.chain.sessionMode === "fork" && p.data.mechanism === "handoff") && p.data.confirmed !== !0 && Q("SESSION_CONFIRMATION_REQUIRED", "A non-native session approximation requires explicit consent."), r.chain.sessionMode === "shared" && p.data.mechanism !== "current-conversation" && Q("SESSION_DECISION_INVALID", "A shared chain must use the current host conversation."), r.chain.sessionMode === "fresh" && !["isolated-worker", "current-conversation"].includes(p.data.mechanism) && Q("SESSION_DECISION_INVALID", "Fresh mode needs a verified isolated worker or an explicitly accepted shared approximation."), r.chain.sessionMode === "fork" && !["native-fork", "handoff"].includes(p.data.mechanism) && Q("SESSION_DECISION_INVALID", "Fork mode needs a verified native fork or an explicitly accepted handoff."), n.installConfirmed !== !0 && Q("INSTALL_CONFIRMATION_REQUIRED", "Review and explicitly confirm package installation first.");
		let m = n.reuseSkills === void 0 ? [] : n.reuseSkills;
		(!Array.isArray(m) || m.some((e) => typeof e != "string")) && Q("REUSE_INVALID", "Reuse choices must be a list of skill names."), (await kh(r, t)).reviewDigest !== n.reviewDigest && Q("REVIEW_STALE", "The bundle, project, or existing package state changed since inspection; review it again."), process.platform === "win32" && r.skills.some((e) => e.files.some((e) => e.executable)) && Q("EXECUTABLE_MODES_UNSUPPORTED", "Windows cannot yet preserve executable modes when installing or reusing bundle skills.");
		let h = await gh(t), g = f();
		return Km(t, "portable", g, () => bh(h, async () => {
			await Ch(h, t);
			let e = await kh(r, t);
			e.reviewDigest !== n.reviewDigest && Q("REVIEW_STALE", "The bundle, project, or existing package state changed since inspection; review it again.");
			let { installedSkills: i, createdDirectories: u } = await hh(r, t, m, n.differingReuseConfirmed === !0, new Map(e.skills.map((e) => [e.name, e.existingFingerprint]))), d = $(), f = {
				version: 1,
				id: g,
				revision: 1,
				projectPath: t,
				bundleFingerprint: th(JSON.stringify(r)),
				bundle: r,
				actualHost: c,
				hostSwitchConfirmed: l,
				progression: s,
				progressionConfirmed: n.progressionConfirmed === !0,
				sessionDecision: p.data,
				resolvedInputs: o,
				skillFingerprintVersion: 2,
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
				await Dh(h, f, !0);
			} catch (e) {
				throw await Promise.all(u.map((e) => ee(e, {
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
	let r = await gh(t);
	e.runId || Q("RUN_ID_INVALID", "Provide a run id.");
	let o = Th(r, e.runId), s = await Sh(o, t);
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
	if (e.command === "step") return qm(t, {
		kind: "portable",
		runId: s.id
	}, () => bh(r, async () => {
		let e = await Sh(o, t);
		n.revision !== e.revision && Q("REVISION_CONFLICT", "Portable run state changed; refresh status before acting."), (e.status !== "ready" || e.resumeRequired) && Q("RUN_NOT_READY", "The run is not ready to start another step."), await Ch(r, t, e.id), await wh(e, t), e.progression === "supervised" && n.confirmed !== !0 && Q("STEP_CONFIRMATION_REQUIRED", "Confirm this step before execution.");
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
		s.attempts.push(c), e.status = "running", e.revision += 1, e.updatedAt = $(), await Dh(r, e);
		let l = sh(e.bundle, e.currentStepIndex, e.resolvedInputs), u = null;
		if (e.bundle.chain.sessionMode === "fork" && e.sessionDecision.mechanism === "handoff" && e.currentStepIndex > 0) {
			let t = e.bundle.chain.steps[e.currentStepIndex - 1], n = e.steps[e.currentStepIndex - 1]?.attempts.at(-1), r = sh(e.bundle, e.currentStepIndex - 1, e.resolvedInputs);
			u = [
				"Portable handoff (not a native session fork):",
				`Previous step: ${String(e.currentStepIndex)} "${Tf(t)}"`,
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
				label: Tf(i),
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
	if (e.command === "record") return qm(t, {
		kind: "portable",
		runId: s.id
	}, () => bh(r, async () => {
		let e = await Sh(o, t);
		if (n.revision !== e.revision && Q("REVISION_CONFLICT", "Portable run state changed; refresh status before acting."), n.action === "pause" || n.action === "abort") return e.status !== "ready" && e.status !== "paused" && Q("RUN_ACTION_INVALID", "Pause or abort is only available between steps."), e.status = n.action === "pause" ? "paused" : "aborted", e.revision += 1, e.updatedAt = $(), await Dh(r, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status
		};
		if (n.action === "retry") {
			let t = e.steps[e.currentStepIndex]?.attempts.at(-1);
			return (e.status !== "paused" || t?.status !== "failed") && Q("RETRY_NOT_AVAILABLE", "Retry is available only for the current failed step."), e.status = "ready", e.revision += 1, e.updatedAt = $(), await Dh(r, e), {
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
			}), e.currentStepIndex += 1, e.status = e.currentStepIndex >= e.steps.length ? "completed" : "ready", e.revision += 1, e.updatedAt = $(), await Dh(r, e), {
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
		return Buffer.byteLength(c, "utf8") > 8192 && Q("SUMMARY_TOO_LARGE", "Step summaries are limited to 8 KiB; do not store a transcript."), a.status = s, a.finishedAt = $(), a.summary = c || null, a.reason = s === "skipped" ? n.reason.slice(0, 2e3) : null, s === "failed" ? e.status = "paused" : (e.currentStepIndex += 1, e.status = e.currentStepIndex >= e.steps.length ? "completed" : "ready"), e.revision += 1, e.updatedAt = $(), await Dh(r, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status,
			currentStepIndex: e.currentStepIndex
		};
	}));
	if (e.command === "resume") return qm(t, {
		kind: "portable",
		runId: s.id
	}, () => bh(r, async () => {
		let e = await Sh(o, t);
		if (n.revision !== e.revision && Q("REVISION_CONFLICT", "Portable run state changed; refresh status before acting."), e.status === "paused" && !e.resumeRequired && n.decision === "continue") return e.status = "ready", e.revision += 1, e.updatedAt = $(), await Dh(r, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status
		};
		if (e.status === "running") {
			n.stoppedConfirmed !== !0 && Q("STOP_CONFIRMATION_REQUIRED", "Confirm that the earlier host work has stopped before marking this attempt interrupted.");
			let t = e.steps[e.currentStepIndex]?.attempts.at(-1);
			return t?.status !== "running" && Q("RUN_STATE_INVALID", "The active run has no in-flight attempt."), t.status = "interrupted", t.finishedAt = $(), e.status = "interrupted", e.resumeRequired = !0, e.revision += 1, e.updatedAt = $(), await Dh(r, e), {
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
		return e.resumeRequired = !1, e.status = i === "failed" ? "paused" : e.currentStepIndex >= e.steps.length ? "completed" : "ready", e.revision += 1, e.updatedAt = $(), await Dh(r, e), {
			ok: !0,
			runId: e.id,
			revision: e.revision,
			status: e.status
		};
	}));
	Q("COMMAND_INVALID", "Unknown portable run command.");
}
// src/portable/cli.ts
var jh = [
	"inspect",
	"prepare",
	"status",
	"step",
	"record",
	"resume"
], Mh = new Set([...l().values()].map(([e]) => e));
Mh.add("ERR_SQLITE_ERROR");
function Nh(e) {
	let t = e[0];
	if (!jh.includes(t)) throw new eh("USAGE", `Usage: loom-bundle <${jh.join("|")}> [--bundle PATH] [--project PATH] [--run-id ID]`);
	let n = { command: t };
	for (let t = 1; t < e.length; t += 1) {
		let r = e[t];
		if (r !== "--bundle" && r !== "--project" && r !== "--run-id") throw new eh("USAGE", `Unknown option "${r}".`);
		let i = e[t + 1];
		if (i === void 0 || i === "" || i.startsWith("--")) throw new eh("USAGE", `Option "${r}" needs a value.`);
		t += 1, r === "--bundle" && (n.bundlePath = i), r === "--project" && (n.projectPath = i), r === "--run-id" && (n.runId = i);
	}
	if (n.command !== "inspect" && n.projectPath === void 0) throw new eh("USAGE", "This command needs --project PATH.");
	if ([
		"status",
		"step",
		"record",
		"resume"
	].includes(n.command) && n.runId === void 0) throw new eh("USAGE", "This command needs --run-id ID.");
	return n;
}
async function Ph(e = process.argv.slice(2), t = {}) {
	let n = t.stdout ?? process.stdout, r = t.stderr ?? process.stderr;
	try {
		let r = Nh(e), i = r.command === "inspect" ? "" : await Fh(t.stdin ?? process.stdin);
		i.trim() !== "" && (r.input = JSON.parse(i));
		let a = await Ah(r);
		return n.write(`${JSON.stringify(a)}\n`), 0;
	} catch (e) {
		let t = e instanceof eh || e instanceof Cp || e instanceof X || e instanceof Wm || e instanceof Bm, n = t ? e.code : e instanceof SyntaxError ? "JSON_INVALID" : "REQUEST_FAILED", i = t ? e.message : e instanceof SyntaxError ? "Structured helper input is not valid JSON." : "The portable helper could not complete the request. Check file permissions and retry.", a = e instanceof Error && "code" in e ? e.code : void 0, o = !t && typeof a == "string" && Mh.has(a) ? a : void 0;
		return r.write(`${JSON.stringify({
			ok: !1,
			error: {
				code: n,
				message: i,
				...o === void 0 ? {} : { systemCode: o }
			}
		})}\n`), 1;
	}
}
async function Fh(e) {
	if (e === void 0 || "isTTY" in e && e.isTTY === !0) return "";
	let t = [], n = 0;
	for await (let r of e) {
		let e = Buffer.isBuffer(r) ? r : Buffer.from(String(r));
		if (n += e.length, n > 8388608) throw new eh("REQUEST_TOO_LARGE", "Structured helper input is limited to 8 MiB.");
		t.push(e);
	}
	return Buffer.concat(t).toString("utf8");
}
function Ih() {
	let e = process.argv[1];
	if (e === void 0 || !["loom-bundle.mjs", "cli.js"].includes(n(e))) return !1;
	try {
		return t(s(e)) === t(u(import.meta.url));
	} catch {
		return !1;
	}
}
Ih() && Ph().then((e) => {
	e !== 0 && (process.exitCode = e);
});
export { Nh as parsePortableArgs, Ph as runPortableCli };
