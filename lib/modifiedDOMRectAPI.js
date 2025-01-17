/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedDOMRectAPI", {});
	}
	
	const {getWrapped, checkerWrapper, setProperties: setProperties} = require("./modifiedAPIFunctions");
	const {byteArrayToString: hash} = require("./hash");
	
	
	let randomSupply = null;
	scope.setRandomSupply = function(supply){
		randomSupply = supply;
	};
	
	function getHash(domRect){
		return hash(new Float64Array([domRect.x, domRect.y, domRect.width, domRect.height]));
	}
	function getValueHash(value){
		return hash(new Float32Array([value]));
	}
	
	const registeredRects = new WeakMap();
	function registerDOMRect(domRect, notify, window, prefs){
		registeredRects.set(getWrapped(domRect), {
			notify: function(){
				let done = false;
				return function(message){
					if (!done){
						done = true;
						notify(message);
					}
				};
			}(),
			window,
			prefs
		});
	}
	function getDOMRectRegistration(domRect){
		return registeredRects.get(getWrapped(domRect));
	}
	
	const cache = {};
	const valueCache = [{}, {}, {}, {}];
	function getFakeDomRect(window, domRect, prefs, notify){
		const hash = getHash(domRect);
		let cached = cache[hash];
		if (!cached){
			notify("fakedDOMRectReadout");
			const rng = randomSupply.getRng(4, window);
			const getFakeValue = function getFakeValue(value, i){
				const valueHash = getValueHash(value);
				const cache = valueCache[i];
				let cachedValue = cache[valueHash];
				if (typeof cachedValue === "number"){
					return cachedValue;
				}
				if ((value * prefs("domRectIntegerFactor", window.location)) % 1 === 0){
					cache[valueHash] = value;
					return value;
				}
				else {
					const fakedValue = value + 0.01 * (rng(i) / 0xffffffff - 0.5);
					const fakedHash = getValueHash(fakedValue);
					cache[valueHash] = fakedValue;
					cache[fakedHash] = fakedValue;
					return fakedValue;
				}
			};
			cached = new domRect.constructor(
				getFakeValue(domRect.x, 0),
				getFakeValue(domRect.y, 1),
				getFakeValue(domRect.width, 2),
				getFakeValue(domRect.height, 3)
			);
			cache[hash] = cached;
			cache[getHash(cached)] = cached;
		}
		return cached;
	}
	
	scope.changedFunctions = {
		getClientRects: {
			object: ["Range", "Element"],
			fakeGenerator: function(checker){
				return function getClientRects(){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const ret = args.length? original.apply(this, window.Array.from(args)): original.call(this);
						for (let i = 0; i < ret.length; i += 1){
							registerDOMRect(ret[i], notify, window, prefs);
						}
						return ret;
					});
				};
			}
		},
		getBoundingClientRect: {
			object: ["Range", "Element"],
			fakeGenerator: function(checker){
				return function getBoundingClientRect(){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const ret = args.length? original.apply(this, window.Array.from(args)): original.call(this);
						registerDOMRect(ret, notify, window, prefs);
						return ret;
					});
				};
				
			}
		},
		getBounds: {
			object: ["DOMQuad"],
			fakeGenerator: function(checker){
				return function getBounds(){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const ret = args.length? original.apply(this, window.Array.from(args)): original.call(this);
						registerDOMRect(ret, notify, window, prefs);
						return ret;
					});
				};
			}
		},
		getBBox: {
			object: ["SVGGraphicsElement"],
			fakeGenerator: function(checker){
				return function getBBox(){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const ret = args.length? original.apply(this, window.Array.from(args)): original.call(this);
						registerDOMRect(ret, notify, window, prefs);
						return ret;
					});
				};
			}
		},
		getExtentOfChar: {
			object: ["SVGTextContentElement"],
			fakeGenerator: function(checker){
				return function getBBox(){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const ret = args.length? original.apply(this, window.Array.from(args)): original.call(this);
						registerDOMRect(ret, notify, window, prefs);
						return ret;
					});
				};
			}
		},
	};
	
	function generateChangedDOMRectPropertyGetter(property, readonly = false){
		const changedGetter = {
			objectGetters: readonly?
				[
					function(window){return window.DOMRectReadOnly && window.DOMRectReadOnly.prototype;}
				]:
				[
					function(window){return window.DOMRect && window.DOMRect.prototype;},
					function(window){return window.DOMRectReadOnly && window.DOMRectReadOnly.prototype;}
				],
			name: property,
			getterGenerator: function(){
				const temp = eval(`({
					get ${property}(){
						const registration = getDOMRectRegistration(this);
						if (registration){
							return getFakeDomRect(
								registration.window,
								this,
								registration.prefs,
								registration.notify
							).${property};
						}
						return this.${property};
					}
				})`);
				return Object.getOwnPropertyDescriptor(temp, property).get;
			}
		};
		if (!readonly){
			changedGetter.setterGenerator = function(window, original, prefs){
				const temp = eval(`({
					set ${property}(newValue){
						const registration = getDOMRectRegistration(this);
						if (registration){
							const fakeDomRect = getFakeDomRect(window, this, prefs, registration.notify);
							registeredRects.delete(getWrapped(this));
							["x", "y", "width", "height"].forEach((prop) => {
								if (prop === "${property}"){
									this[prop] = newValue;
								}
								else {
									this[prop] = fakeDomRect[prop];
								}
							});
						}
						else {
							original.apply(this, window.Array.from(arguments));
						}
					}
				})`);
				return Object.getOwnPropertyDescriptor(temp, property).set;
			};
		}
		return changedGetter;
	}
	
	scope.changedGetters = [
		generateChangedDOMRectPropertyGetter("x",      false),
		generateChangedDOMRectPropertyGetter("y",      false),
		generateChangedDOMRectPropertyGetter("width",  false),
		generateChangedDOMRectPropertyGetter("height", false),
		generateChangedDOMRectPropertyGetter("left",   true),
		generateChangedDOMRectPropertyGetter("right",  true),
		generateChangedDOMRectPropertyGetter("top",    true),
		generateChangedDOMRectPropertyGetter("bottom", true),
		{
			objectGetters: [
				function(window){
					return window.IntersectionObserverEntry && window.IntersectionObserverEntry.prototype;
				}
			],
			name: "intersectionRect",
			getterGenerator: function(checker){
				const temp = {
					get intersectionRect(){
						return checkerWrapper(checker, this, arguments, function(args, check){
							const {prefs, notify, window, original} = check;
							const originalValue = args.length?
								original.apply(this, window.Array.from(args)):
								original.call(this);
							registerDOMRect(originalValue, notify, window, prefs);
							return originalValue;
						});
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "intersectionRect").get;
			}
		},
		{
			objectGetters: [
				function(window){
					return window.IntersectionObserverEntry && window.IntersectionObserverEntry.prototype;
				}
			],
			name: "boundingClientRect",
			getterGenerator: function(checker){
				const temp = {
					get boundingClientRect(){
						return checkerWrapper(checker, this, arguments, function(args, check){
							const {prefs, notify, window, original} = check;
							const originalValue = args.length?
								original.apply(this, window.Array.from(args)):
								original.call(this);
							registerDOMRect(originalValue, notify, window, prefs);
							return originalValue;
						});
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "boundingClientRect").get;
			}
		},
		{
			objectGetters: [
				function(window){
					return window.IntersectionObserverEntry && window.IntersectionObserverEntry.prototype;
				}
			],
			name: "rootBounds",
			getterGenerator: function(checker){
				const temp = {
					get rootBounds(){
						return checkerWrapper(checker, this, arguments, function(args, check){
							const {prefs, notify, window, original} = check;
							const originalValue = args.length?
								original.apply(this, window.Array.from(args)):
								original.call(this);
							registerDOMRect(originalValue, notify, window, prefs);
							return originalValue;
						});
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "rootBounds").get;
			}
		}
	];
	
	function getStatus(obj, status, prefs){
		status = Object.create(status);
		status.active = prefs("protectDOMRect", status.url);
		return status;
	}
	
	setProperties(scope.changedFunctions, scope.changedGetters, {
		type: "readout",
		getStatus: getStatus,
		api: "domRect"
	});
}());