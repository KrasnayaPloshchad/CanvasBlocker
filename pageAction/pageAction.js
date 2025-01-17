/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";

	const extension = require("../lib/extension");
	const settings = require("../lib/settings");
	const {parseErrorStack} = require("../lib/callingStack");
	const {error, warning, message, notice, verbose, setPrefix: setLogPrefix} = require("../lib/logging");
	setLogPrefix("page action script");

	const domainNotification = require("./domainNotification");
	const Notification = require("./Notification");
	const {createActionButtons, modalPrompt, modalChoice} = require("./gui");
	const lists = require("../lib/lists");
	require("../lib/theme").init("pageAction");

	Promise.all([
		browser.tabs.query({active: true, currentWindow: true}),
		settings.loaded
	]).then(function(values){
		const tabs = values[0];
		
		notice("create global action buttons");

		createActionButtons(
			document.getElementById("globalActions"),
			[
				{
					name: "showOptions",
					isIcon: true,
					callback: function(){
						if (browser.runtime && browser.runtime.openOptionsPage){
							browser.runtime.openOptionsPage();
						}
						else {
							window.open(browser.extension.getURL("options/options.html"), "_blank");
						}
					}
				},
				{
					name: "disableNotifications",
					isIcon: true,
					callback: function(){
						settings.set("showNotifications", false).then(function(){
							window.close();
						});
					}
				}
			],
			undefined,
			true
		);
		
		if (!tabs.length){
			throw new Error("noTabsFound");
		}
		else if (tabs.length > 1){
			error(tabs);
			throw new Error("tooManyTabsFound");
		}
		
		function domainOrUrlPicker(domain, urls, selectText, urlInputText){
			const choices = Array.from(urls).map(function(url){
				return {
					text: url,
					value: "^" + url.replace(/([\\+*?[^\]$(){}=!|.])/g, "\\$1") + "$"
				};
			});
			if (domain){
				choices.unshift(domain);
			}
			return modalChoice(
				selectText,
				choices
			).then(function(choice){
				if (choice.startsWith("^")){
					return modalPrompt(
						urlInputText,
						choice
					);
				}
				else {
					return choice;
				}
			});
		}
		
		verbose("registering domain actions");
		[
			{
				name: "ignorelist",
				isIcon: true,
				callback: function({domain, urls}){
					domainOrUrlPicker(
						domain,
						urls,
						extension.getTranslation("selectIgnore"),
						extension.getTranslation("inputIgnoreURL")
					).then(function(choice){
						if (choice){
							settings.set("showNotifications", false, choice).then(function(){
								window.close();
							});
						}
						else {
							window.close();
						}
					});
				}
			},
			{
				name: "whitelist",
				isIcon: true,
				callback: function({domain, urls, api}){
					const whitelistingSettings = {
						all: {name: "blockMode", value: "allow"},
						canvas: {name: "protectedCanvasPart", value: "nothing"},
						audio: {name: "protectAudio", value: false},
						domRect: {name: "protectDOMRect", value: false},
						history: {name: "historyLengthThreshold", value: 10000},
						navigator: {name: "protectNavigator", value: false},
						windows: {name: "protectWindow", value: false}
						
					};
					domainOrUrlPicker(
						domain,
						urls,
						extension.getTranslation("selectWhitelist"),
						extension.getTranslation("inputWhitelistURL")
					).then(function(choice){
						if (
							api &&
							whitelistingSettings[api]
						){
							return modalChoice(
								extension.getTranslation("selectWhitelistScope"),
								[
									{
										text: extension.getTranslation("whitelistOnlyAPI")
											.replace(
												/\{api\}/g,
												extension.getTranslation("section_" + api + "-api")
											),
										value: api
									},
									{
										text: extension.getTranslation("whitelistAllAPIs"),
										value: "all"
									}
								]
							).then(function(selection){
								return {choice, setting: whitelistingSettings[selection]};
							});
						}
						else {
							return {choice, setting: whitelistingSettings.all};
						}
					}).then(function({choice, setting}){
						if (choice){
							settings.set(setting.name, setting.value, choice).then(function(){
								window.close();
							});
						}
						else {
							window.close();
						}
					});
				}
			},
			{
				name: "whitelistTemporarily",
				isIcon: true,
				callback: function({domain, urls}){
					domainOrUrlPicker(
						domain,
						urls,
						extension.getTranslation("selectSessionWhitelist"),
						extension.getTranslation("inputSessionWhitelistURL")
					).then(function(choice){
						if (choice){
							lists.appendTo("sessionWhite", choice).then(function(){
								window.close();
							});
						}
						else {
							window.close();
						}
					});
				}
			},
			{
				name: "inspectWhitelist",
				isIcon: true,
				callback: function({domain, urls}){
					window.open(
						browser.extension.getURL(
							"options/whitelist.html?domain=" +
							encodeURIComponent(domain) +
							"&urls=" +
							encodeURIComponent(JSON.stringify(Array.from(urls.values())))
						),
						"_blank"
					);
				}
			}
		].forEach(function(domainAction){
			domainNotification.addAction(domainAction);
		});

		verbose("registering notification actions");
		[
			{
				name: "displayFullURL",
				isIcon: true,
				callback: function({url}){
					alert(url.href);
				}
			},
			{
				name: "displayCallingStack",
				isIcon: true,
				callback: function({errorStack}){
					alert(parseErrorStack(errorStack));
				}
			}
		].forEach(function(action){
			Notification.addAction(action);
		});
		
		var tab = tabs[0];
		extension.message.on(function(data){
			if (data["canvasBlocker-notificationCounter"]){
				const url = new URL(data.url);
				Object.keys(data["canvasBlocker-notificationCounter"]).forEach(function(key){
					const notification = domainNotification(
						url,
						key,
						data["canvasBlocker-notificationCounter"][key].count,
						data["canvasBlocker-notificationCounter"][key].api
					);
				});
			}
			if (
				Array.isArray(data["canvasBlocker-notifications"]) &&
				data["canvasBlocker-notifications"].length
			){
				message("got notifications");
				const notifications = data["canvasBlocker-notifications"];
				let i = 0;
				const length = notifications.length;
				const tick = window.setInterval(function(){
					if (i >= length){
						window.clearInterval(tick);
					}
					else {
						for (var delta = 0; delta < 20 && i + delta < length; delta += 1){
							let notification = notifications[i + delta];
							verbose(notification);
							if (settings.ignoredAPIs[notification.api]){
								continue;
							}
							verbose(notification);
							notification.url = new URL(notification.url);
							domainNotification(
								notification.url,
								notification.messageId,
								0,
								notification.api
							).addNotification(new Notification(notification));
						}
						i += delta;
					}
				}, 1);
			}
		});
		message("request notifications from tab", tab.id);
		browser.tabs.sendMessage(
			tab.id,
			{
				"canvasBlocker-sendNotifications": tab.id
			}
		);
		notice("waiting for notifications");
	}).catch(function(e){
		error(e);
	});
}());