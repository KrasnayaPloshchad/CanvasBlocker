/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	const extension = require("../lib/extension");
	const logging = require("../lib/logging");
	logging.setPrefix("options page");
	
	const optionsGui = require("./optionsGui");
	const settings = require("../lib/settings");
	const settingsDisplay = require("../lib/settingsDisplay");
	const search = require("../lib/search");
	const settingStrings = require("../lib/settingStrings");
	const searchParameters = new URLSearchParams(window.location.search);
	const settingsMigration = require("../lib/settingsMigration");
	require("./theme").init("options");
	const modal = require("../lib/modal");
	
	var callbacks = {
		openNavigatorSettings: function(){
			logging.verbose("open navigator settings");
			window.open("navigator.html", "_blank");
		},
		showReleaseNotes: function(){
			logging.verbose("open release notes");
			window.open("../releaseNotes.txt", "_blank");
		},
		clearPersistentRnd: function(){
			logging.message("clear persistent rnd storage");
			logging.notice("empty storage");
			settings.persistentRndStorage = "";
			logging.notice("send message to main script");
			extension.message.send({"canvasBlocker-clear-domain-rnd": true});
		},
		clearPersistentRndForContainer: function(){
			browser.contextualIdentities.query({}).then(function(identities){
				modal.select(
					extension.getTranslation("clearPersistentRndForContainer_title"),
					identities.map(function(identity){
						return {
							name: `${identity.name} (${identity.cookieStoreId})`,
							object: identity
						};
					})
				).then(function(identity){
					extension.message.send({"canvasBlocker-clear-container-rnd": identity.cookieStoreId});
				}, ()=>{});
			});
		},
		inspectSettings: function(){
			logging.verbose("open settings inspection");
			window.open("export.html", "_blank");
		},
		openSettingSanitation: function(){
			logging.verbose("open settings sanitation");
			window.open("sanitize.html", "_blank");
		},
		saveSettings: function(){
			logging.verbose("save settings");
			const data = {};
			settings.forEach(function(def){
				data[def.name] = def.get();
			});
			const blob = new Blob([JSON.stringify(data, null, "\t")], {type: "application/json"});
			const link = document.createElement("a");
			link.href = window.URL.createObjectURL(blob);
			link.target = "_blank";
			const now = new Date();
			function format(number, digits){
				var str = number.toFixed(0);
				return "0".repeat(digits - str.length) + str;
			}
			link.download = "CanvasBlocker-settings_" +
				format(now.getFullYear(), 4) + "-" +
				format(now.getMonth() + 1, 2) + "-" +
				format(now.getDate(), 2) + "_" +
				format(now.getHours(), 2) + "-" +
				format(now.getMinutes(), 2) + "-" +
				format(now.getSeconds(), 2) +
				".json";
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		},
		inspectWhitelist: function(){
			logging.verbose("open whitelist inspection");
			window.open("whitelist.html", "_blank");
		},
		loadSettings: function(){
			logging.verbose("load settings");
			new Promise(function(resolve, reject){
				const input = document.createElement("input");
				input.type = "file";
				input.addEventListener("change", function(){
					if (this.files.length){
						var file = this.files[0];
						var reader = new FileReader();
						reader.onload = function(result){
							resolve(this.result);
						};
						reader.onerror = function(err){
							reject(err);
						};
						reader.readAsText(this.files[0]);
					}
				});
				input.click();
			}).then(function(text){
				return JSON.parse(text);
			}).then(function(json){
				while (settingsMigration.transitions.hasOwnProperty(json.storageVersion)){
					let oldVersion = json.storageVersion;
					json = settingsMigration.transitions[json.storageVersion](json);
					if (oldVersion === json.storageVersion){
						break;
					}
				}
				const keys = Object.keys(json);
				keys.forEach(function(key){
					const setting = settings.getDefinition(key);
					if (!settings){
						throw new Error("Unknown setting " + key + ".");
					}
					if (!setting.fixed && setting.invalid(json[key])){
						throw new Error("Invalid value " + json[key] + " for " + key + ".");
					}
				});
				keys.forEach(function(key){
					settings[key] = json[key];
				});
			}).catch(function(err){
				alert(err);
			});
		},
		resetSettings: function(){
			modal.confirm(
				extension.getTranslation("resetSettings_confirm"),
				{
					node: this,
					selector: ".settingRow .content"
				}
			).then(function(clear){
				if (clear){
					browser.storage.local.clear();
				}
			});
		}
	};
	
	new Promise(function(resolve){
		const port = browser.runtime.connect();
		port.onMessage.addListener(function(data){
			if (data.hasOwnProperty("tabId")){
				logging.notice("my tab id is", data.tabId);
				port.disconnect();
				resolve(data.tabId);
			}
		});
	}).then(function(tabId){
		return browser.tabs.get(tabId);
	}).then(function(tab){
		document.querySelector("head title").textContent = extension.getTranslation("options_title");
		let head = document.createElement("header");
		document.body.insertBefore(head, document.body.firstChild);
		
		if (tab.url === window.location.href){
			let heading = document.createElement("h1");
			heading.textContent = extension.getTranslation("options");
			head.appendChild(heading);
			
			let introduction = document.createElement("div");
			introduction.textContent = extension.getTranslation("optionsIntroduction");
			head.appendChild(introduction);
			
			if (searchParameters.has("notice")){
				let noticeName = searchParameters.get("notice") + "Notice";
				let notice = extension.getTranslation(noticeName);
				if (notice){
					let bookmarkingNotice = document.createElement("div");
					bookmarkingNotice.className = noticeName + " bookmarkNotice";
					bookmarkingNotice.textContent = notice;
					
					const dontShowAgain = document.createElement("label");
					dontShowAgain.className = "dontShowOptionsOnUpdate";
					const dontShowAgainInput = document.createElement("input");
					dontShowAgainInput.type = "checkbox";
					settings.onloaded(function(){
						dontShowAgainInput.checked = settings.dontShowOptionsOnUpdate;
					});
					dontShowAgainInput.addEventListener("change", function(){
						settings.dontShowOptionsOnUpdate = this.checked;
					});
					dontShowAgain.appendChild(dontShowAgainInput);
					dontShowAgain.appendChild(
						document.createTextNode(
							" " + extension.getTranslation("dontShowOptionsOnUpdate")
						)
					);
					bookmarkingNotice.appendChild(dontShowAgain);
					
					head.appendChild(bookmarkingNotice);
					
					const newUrl = new URL(window.location.href);
					newUrl.search = "";
					window.history.pushState({}, "", newUrl.href);
				}
			}
			
			document.body.classList.add("standalone");
		}
		else {
			const linkDiv = document.createElement("div");
			linkDiv.className = "optionsLink";
			const link = document.createElement("a");
			link.href = window.location.href;
			link.target = "_blank";
			link.textContent = extension.getTranslation("openInTab");
			linkDiv.appendChild(link);
			head.appendChild(linkDiv);
		}
	});
	
	var groupTabs = document.createElement("div");
	groupTabs.classList = "groupTabs";
	document.body.appendChild(groupTabs);
	
	var groups = document.createElement("ul");
	groups.className = "groups";
	groupTabs.appendChild(groups);
	
	var table = document.createElement("table");
	table.className = "settings " + (settings.displayDescriptions? "display": "hide") + "Descriptions";
	settings.on("displayDescriptions", function(){
		table.className = "settings " + (settings.displayDescriptions? "display": "hide") + "Descriptions";
	});
	var tableContainer = document.createElement("div");
	tableContainer.classList = "tabContents";
	groupTabs.appendChild(tableContainer);
	
	tableContainer.appendChild(table);
	
	const displayHidden = settings.getDefinition(settingsDisplay.displayHidden);
	const searchInput = search.init();
	table.appendChild(
		optionsGui.createThead(
			displayHidden,
			searchInput
		)
	);
	const searchOnly = searchParameters.has("searchOnly");
	if (searchOnly){
		document.body.classList.add("searching");
	}
	if (searchParameters.has("search")){
		searchInput.value = searchParameters.get("search");
	}
	search.on(function({search, results, lastResults}){
		lastResults.forEach(function(node){
			node.classList.remove("found");
		});
		if (search || searchOnly){
			document.body.classList.add("searching");
			results.forEach(function(node){
				node.classList.add("found");
			});
		}
		else {
			document.body.classList.remove("searching");
		}
	});
	
	const {hide: hideContainer, expand: expandContainer} = settings.getContainers();
	
	const addGroup = function addGroup(groupDefinition){
		const sections = [];
		const group = {
			select: function(){
				groups.querySelectorAll(".selected").forEach(function(group){
					group.classList.remove("selected");
				});
				table.querySelectorAll("tbody").forEach(function(section){
					section.classList.remove("selectedGroup");
				});
				sections.forEach(function(section){
					section.node.classList.add("selectedGroup");
				});
				name.classList.add("selected");
			},
			addSection: function(sectionDefinition){
				const section = addSection(sectionDefinition.name);
				sections.push(section);
				return section;
			}
		};
		
		const groupIndex = groups.childNodes.length;
		const name = document.createElement("li");
		name.textContent = extension.getTranslation("group_" + groupDefinition.name);
		name.className = "groupName group" + groupIndex;
		
		
		name.addEventListener("click", group.select);
		
		groups.appendChild(name);
		
		return group;
	};
	
	const addSection = function addSection(name){
		const body = document.createElement("tbody");
		if (name){
			const row = document.createElement("tr");
			row.className = "section";
			
			const cell = document.createElement("td");
			cell.colSpan = 3;
			row.appendChild(cell);
			
			const id = "section_" + name;
			
			const heading = document.createElement("h2");
			heading.textContent = extension.getTranslation(id);
			cell.appendChild(heading);
			
			if (expandContainer){
				const collapser = document.createElement("span");
				collapser.className = "collapser";
				collapser.addEventListener("click", function(){
					expandContainer.setExpandByName(id, !expandContainer.getExpandByName(id, true));
				});
				expandContainer.onExpandChange(id, function(value){
					body.classList[value? "remove": "add"]("collapsed");
				});
				if (!expandContainer.getExpandByName(id, true)){
					body.classList.add("collapsed");
				}
				heading.appendChild(collapser);
			}
			
			body.appendChild(row);
		}
		table.appendChild(body);
		const rows = [];
		const section = {
			node: body,
			addRow: function(row){
				rows.push(row);
				body.appendChild(row);
			},
			updateDisplay: function(){
				const searchMode = document.body.classList.contains("searching");
				var anyVisible = false;
				rows.forEach(function(row){
					var isHidden = row.classList.contains("hidden");
					if (!isHidden){
						if (searchMode){
							if (!row.classList.contains("found")){
								return;
							}
						}
						if (anyVisible){
							row.classList.remove("firstVisible");
						}
						else {
							anyVisible = true;
							row.classList.add("firstVisible");
						}
					}
				});
				body.classList[anyVisible? "remove": "add"]("hidden");
			}
		};
		
		search.on(function(){section.updateDisplay();});
		return section;
	};
	
	const beforeChangeEventListeners = {};
	settingsDisplay.map(function(groupDefinition){
		const group = addGroup(groupDefinition);
		groupDefinition.sections.forEach(function(sectionDefinition){
			const section = group.addSection(sectionDefinition);
			sectionDefinition.settings.forEach(function(display){
				var setting = settings.getDefinition(display.name);
				if (!setting){
					if (display.inputs){
						setting = {
							name: display.name,
							inputs: display.inputs.map(settings.getDefinition)
						};
					}
					else if (display.actions){
						setting = {
							name: display.name,
							actions: display.actions.map(function(action){
								return {
									name: action,
									action: callbacks[action]
								};
							}).filter(function(action){
								return action.action;
							})
						};
					}
					else if (callbacks[display.name]){
						setting = {
							name: display.name,
							action: callbacks[display.name]
						};
					}
				}
				if (setting){
					setting.display = display;
					
					let originalSet = setting.set;
					setting.originalSet = originalSet;
					if (originalSet){
						const eventListeners = [];
						beforeChangeEventListeners[setting.name] = eventListeners;
						setting.set = function(...args){
							if (eventListeners.every(function(listener){
								return listener.call(setting, ...args);
							})){
								return originalSet.apply(this, args);
							}
							else {
								return false;
							}
						};
					}
					
					let hideChangeListeners = [];
					setting.setHide = function setHide(value){
						if (hideContainer){
							hideContainer.setHideByName(display.name, value);
							if (computeDependencies){
								computeDependencies();
							}
						}
					};
					setting.onHideChange = function(listener){
						hideChangeListeners.push(listener);
					};
					setting.getHide = function getHide(){
						if (hideContainer){
							return hideContainer.getHideByName(display.name);
						}
						else {
							return false;
						}
					};
					if (hideContainer){
						hideContainer.onHideChange(display.name, function(value){
							if (computeDependencies){
								computeDependencies();
							}
							hideChangeListeners.forEach(function(listener){
								listener(value);
							});
						});
					}
					
					let expandChangeListeners = [];
					setting.setExpand = function setExpand(value){
						if (expandContainer){
							expandContainer.setExpandByName(display.name, value);
						}
					};
					setting.onExpandChange = function(listener){
						expandChangeListeners.push(listener);
					};
					setting.getExpand = function getExpand(){
						if (expandContainer){
							return expandContainer.getExpandByName(display.name);
						}
						else {
							return false;
						}
					};
					if (expandContainer){
						expandContainer.onExpandChange(display.name, function(value){
							expandChangeListeners.forEach(function(listener){
								listener(value);
							});
						});
					}
					
					var row = optionsGui.createSettingRow(setting);
					settingStrings.getStrings(setting).forEach(function(string){
						search.register(string, row);
					});
					section.addRow(row);
					if (!display.displayDependencies){
						display.displayDependencies = {};
					}
					var displayDependencies = display.displayDependencies;
					displayDependencies = Array.isArray(displayDependencies)?
						displayDependencies:
						[displayDependencies];
					var computeDependencies = function(){
						logging.verbose("evaluate display dependencies for", setting);
						row.classList[(
							(
								displayHidden.get() ||
								!setting.getHide()
							) &&
							displayDependencies.some(function(displayDependency){
								return Object.keys(displayDependency).every(function(key){
									return displayDependency[key].indexOf(settings[key]) !== -1;
								});
							})
						)? "remove": "add"]("hidden");
						section.updateDisplay();
					};
					computeDependencies();
					displayDependencies.forEach(function(displayDependency){
						Object.keys(displayDependency).forEach(function(name){
							settings.on(name, computeDependencies);
						});
					});
					displayHidden.on(computeDependencies);
				}
			});
		});
		return group;
	})[0].select();
	
	const version = document.createElement("div");
	version.className = "version";
	fetch(browser.extension.getURL("manifest.json")).then(function(response){
		return response.json();
	}).then(function(manifest){
		version.textContent = "Version " + manifest.version;
	});
	document.body.appendChild(version);
	
	settings.onloaded(function(){
		const reCaptchaEntry = "^https://www\\.google\\.com/recaptcha/api2/(?:b?frame|anchor).*$";
		const {url: urlContainer} = settings.getContainers();
		settings.on("protectWindow", function({newValue}){
			if (newValue){
				const urlValue = urlContainer.get();
				const matching = urlValue.filter(function(entry){
					return entry.url === reCaptchaEntry;
				});
				if (
					newValue &&
					(
						matching.length === 0 ||
						matching[0].protectWindow
					)
				){
					modal.confirm(
						extension.getTranslation("protectWindow_askReCaptchaException"),
						{
							node: document.querySelector("[data-storage-name=protectWindow]"),
							selector: ".settingRow .content"
						}
					).then(function(addException){
						if (addException){
							settings.set("protectWindow", false, reCaptchaEntry);
						}
					});
				}
			}
		});
		beforeChangeEventListeners.sharePersistentRndBetweenDomains.push(function(value, ...args){
			if (value){
				modal.confirm(
					extension.getTranslation("sharePersistentRndBetweenDomains_confirmMessage"),
					{
						node: document.querySelector("[data-storage-name=sharePersistentRndBetweenDomains]"),
						selector: ".settingRow .content"
					}
				).then((reallyShare) => {
					if (reallyShare){
						this.originalSet(value, ...args);
					}
				});
				return false;
			}
			return true;
		});
	});
	
	searchInput.search();
}());
