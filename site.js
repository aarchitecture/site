(function () {
  const shell = document.getElementById("site-shell");
  const homePage = document.getElementById("home-page");
  const blogPage = document.getElementById("blog-page");
  const postPage = document.getElementById("post-page");
  const postReader = document.getElementById("post-reader");

  if (!shell || !homePage || !blogPage || !postPage || !postReader) {
    return;
  }

  let currentPostPath = "";

  document.querySelectorAll("[data-open-blog]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setHash("blog");
    });
  });

  document.querySelectorAll("[data-close-blog]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setHash("home");
    });
  });

  document.querySelectorAll("[data-open-post]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openPost(link.getAttribute("href"));
    });
  });

  document.querySelectorAll("[data-close-post]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setHash("blog");
    });
  });

  window.addEventListener("hashchange", routeFromHash);
  routeFromHash();

  function routeFromHash() {
    const route = readRoute();
    const isBlogOpen = route.name === "blog";
    const isPostOpen = route.name === "post";

    shell.classList.toggle("is-blog-open", isBlogOpen);
    shell.classList.toggle("is-post-open", isPostOpen);
    homePage.setAttribute("aria-hidden", String(route.name !== "home"));
    blogPage.setAttribute("aria-hidden", String(!isBlogOpen));
    postPage.setAttribute("aria-hidden", String(!isPostOpen));

    if (isPostOpen) {
      loadPost(route.path);
    }
  }

  function setHash(route) {
    if (window.location.hash.slice(1) === route) {
      routeFromHash();
      return;
    }

    window.location.hash = route;
  }

  function openPost(path) {
    if (!path) {
      return;
    }

    setHash("post=" + encodeURIComponent(path));
  }

  function readRoute() {
    const hash = window.location.hash.slice(1);

    if (hash.indexOf("post=") === 0) {
      return {
        name: "post",
        path: decodeValue(hash.slice(5)),
      };
    }

    if (hash === "blog") {
      return { name: "blog" };
    }

    return { name: "home" };
  }

  function decodeValue(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function loadPost(path) {
    if (!path || currentPostPath === path) {
      return;
    }

    currentPostPath = path;
    postReader.innerHTML = "<p>loading&hellip;</p>";

    fetch(path)
      .then((response) => {
        if (!response.ok) {
          throw new Error("could not load " + path);
        }

        return response.text();
      })
      .then((markdown) => {
        if (currentPostPath === path) {
          postReader.innerHTML = renderMarkdown(markdown);
        }
      })
      .catch(() => {
        if (currentPostPath === path) {
          postReader.innerHTML = "<p>couldn't load that post.</p>";
        }
      });
  }

  function renderMarkdown(markdown) {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let paragraph = [];
    let list = [];
    let code = [];
    let inCode = false;

    lines.forEach((line) => {
      if (line.indexOf("```") === 0) {
        if (inCode) {
          html.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
          code = [];
          inCode = false;
        } else {
          flushParagraph();
          flushList();
          inCode = true;
        }
        return;
      }

      if (inCode) {
        code.push(line);
        return;
      }

      if (!line.trim()) {
        flushParagraph();
        flushList();
        return;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length;
        html.push("<h" + level + ">" + renderInline(heading[2]) + "</h" + level + ">");
        return;
      }

      const listItem = line.match(/^[-*]\s+(.+)$/);
      if (listItem) {
        flushParagraph();
        list.push("<li>" + renderInline(listItem[1]) + "</li>");
        return;
      }

      flushList();
      paragraph.push(line.trim());
    });

    flushParagraph();
    flushList();

    if (inCode) {
      html.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
    }

    return html.join("");

    function flushParagraph() {
      if (paragraph.length) {
        html.push("<p>" + renderInline(paragraph.join(" ")) + "</p>");
        paragraph = [];
      }
    }

    function flushList() {
      if (list.length) {
        html.push("<ul>" + list.join("") + "</ul>");
        list = [];
      }
    }
  }

  function renderInline(text) {
    const codeSpans = [];
    const marker = "\u0000code";
    const encoded = escapeHtml(
      text.replace(/`([^`]+)`/g, (_, code) => {
        codeSpans.push(code);
        return marker + (codeSpans.length - 1) + "\u0000";
      })
    );

    return encoded
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
        return '<a href="' + escapeAttribute(url) + '">' + label + "</a>";
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(new RegExp(marker + "(\\d+)\u0000", "g"), (_, index) => {
        return "<code>" + escapeHtml(codeSpans[Number(index)]) + "</code>";
      });
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (character) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[character];
    });
  }

  function escapeAttribute(text) {
    return escapeHtml(text).replace(/`/g, "&#96;");
  }
})();
