// ==UserScript==
// @name         Daikin CORS Bypass (Clim Annexe)
// @namespace    tommdj.daikin
// @version      1.4
// @description  Permet à daikin_control.html de lire les réponses de l'API locale Daikin (contourne le blocage CORS du navigateur via GM_xmlhttpRequest, qui n'est pas soumis au CORS).
// @match        file:///*daikin_control*.html
// @match        http://localhost/*daikin_control*.html
// @match        http://127.0.0.1/*daikin_control*.html
// @match        https://tomia2652.github.io/clim-annexe/*
// @match        https://*/*daikin_control*.html
// @match        http://*/*daikin_control*.html
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";
  // IMPORTANT : selon le mode d'injection du navigateur, `window` à l'intérieur d'un userscript
  // peut être un environnement isolé, différent de celui que voit réellement la page. Patcher
  // `window.fetch` dans ce cas ne change rien pour la page. `unsafeWindow` pointe toujours vers le
  // vrai contexte de la page — c'est lui qu'il faut patcher pour que ça marche.
  const target = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const realFetch = target.fetch.bind(target);
  // Utiliser les constructeurs natifs de la page (pas ceux de la sandbox du userscript) pour que
  // l'objet Response/Promise/erreurs renvoyé soit bien reconnu comme "normal" par le code de la page.
  const PageResponse = target.Response || Response;
  const PagePromise = target.Promise || Promise;
  const PageTypeError = target.TypeError || TypeError;
  const PageDOMException = target.DOMException || DOMException;
  // IPv4 privées (RFC1918) : 10.x, 172.16-31.x, 192.168.x — c'est là que vit la Daikin.
  const LOCAL_IP_RE = /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/i;

  target.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = (init && init.method) || "GET";

    // On ne dévie que les requêtes vers une IP de réseau local (la Daikin, ou un candidat scanné
    // par le scanner réseau) — tout le reste continue de passer par le fetch natif.
    if (!LOCAL_IP_RE.test(url)) {
      return realFetch(input, init);
    }

    return new PagePromise((resolve, reject) => {
      const signal = init && init.signal;
      if (signal && signal.aborted) {
        reject(new PageDOMException("Aborted", "AbortError"));
        return;
      }

      const req = GM_xmlhttpRequest({
        method: method,
        url: url,
        timeout: 6000,
        onload: function (res) {
          // status peut valoir 0 dans de rares cas d'échec réseau ; Response refuse ce statut.
          const status = res.status >= 200 && res.status <= 599 ? res.status : 502;
          resolve(
            new PageResponse(res.responseText, {
              status: status,
              statusText: res.statusText || "",
            })
          );
        },
        onerror: function () {
          reject(new PageTypeError("GM_xmlhttpRequest: échec réseau vers " + url));
        },
        ontimeout: function () {
          reject(new PageTypeError("GM_xmlhttpRequest: timeout vers " + url));
        },
        onabort: function () {
          reject(new PageDOMException("Aborted", "AbortError"));
        },
      });

      // Relie l'AbortController de la page (utilisé par le scanner réseau pour limiter le temps
      // passé sur chaque IP candidate) à l'annulation réelle de la requête GM.
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            try {
              req.abort();
            } catch (e) {
              /* ignore */
            }
          },
          { once: true }
        );
      }
    });
  };
})();
