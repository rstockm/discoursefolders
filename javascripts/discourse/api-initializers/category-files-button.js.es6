import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("0.11.7", (api) => {
  // Button dynamisch über JavaScript hinzufügen
  api.onPageChange(() => {
    // Warte kurz, damit das DOM vollständig geladen ist
    setTimeout(() => {
      const category = getCurrentCategory();
      if (category) {
        console.log("[Category Files Button] Kategorie gefunden:", category);
        addFilesButtonIfNotExists(category);
      } else {
        console.log("[Category Files Button] Keine Kategorie gefunden");
      }
    }, 500);
  });

  // Auch direkt beim Laden versuchen
  setTimeout(() => {
    const category = getCurrentCategory();
    if (category) {
      console.log("[Category Files Button] Initial - Kategorie gefunden:", category);
      addFilesButtonIfNotExists(category);
    }
  }, 1000);
});

function getCurrentCategory() {
  // Versuche Kategorie aus dem DOM zu holen
  const categoryElement = document.querySelector("[data-category-id]");
  if (categoryElement) {
    const categoryId = parseInt(categoryElement.getAttribute("data-category-id"));
    const categoryName = categoryElement.getAttribute("data-category-name") || 
                        document.querySelector(".category-title h1")?.textContent?.trim() ||
                        "Unbekannt";
    
    return {
      id: categoryId,
      name: categoryName,
    };
  }

  // Fallback: Versuche aus der URL zu extrahieren
  const urlMatch = window.location.pathname.match(/\/c\/([^\/]+)\/(\d+)/);
  if (urlMatch) {
    return {
      id: parseInt(urlMatch[2]),
      name: urlMatch[1].replace(/-/g, " "),
    };
  }

  // Versuche aus Discourse's App zu holen
  try {
    const app = window.__discourse__?.app;
    if (app) {
      const route = app.__container__?.lookup("controller:discovery.category");
      if (route?.category) {
        return {
          id: route.category.id,
          name: route.category.name,
          subcategory_list: route.category.subcategory_list,
        };
      }
    }
  } catch (e) {
    // Ignoriere Fehler
  }

  return null;
}

function addFilesButtonIfNotExists(category) {
  // Prüfen ob Button bereits existiert
  if (document.querySelector(".category-files-button-dynamic")) {
    console.log("[Category Files Button] Button existiert bereits");
    return;
  }

  // Suche nach verschiedenen möglichen Containern
  const selectors = [
    ".category-title-buttons",
    ".category-header",
    ".category-header-contents",
    ".category-title",
    ".category-box",
    ".category-title-wrapper",
    ".list-controls",
    ".navigation-container",
    "[data-category-id]",
  ];

  let header = null;
  for (const selector of selectors) {
    header = document.querySelector(selector);
    if (header) {
      console.log("[Category Files Button] Container gefunden:", selector);
      break;
    }
  }

  if (!header) {
    // Wenn kein Header gefunden, versuche nach dem Category-Title zu suchen
    const categoryTitle = document.querySelector(".category-title h1") ||
                         document.querySelector("h1.category-title") ||
                         document.querySelector("h1");
    
    if (categoryTitle) {
      console.log("[Category Files Button] Category-Title gefunden, erstelle Container");
      const wrapper = categoryTitle.parentElement || categoryTitle.closest(".category-title") || document.querySelector(".list-controls");
      if (wrapper) {
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "category-title-buttons";
        buttonContainer.style.marginLeft = "1em";
        wrapper.appendChild(buttonContainer);
        addButtonToContainer(buttonContainer, category);
        return;
      }
    }
    
    // Letzter Fallback: Füge Button nach dem Heading hinzu
    const heading = document.querySelector("h1");
    if (heading && heading.parentElement) {
      console.log("[Category Files Button] Füge Button nach Heading hinzu");
      const buttonContainer = document.createElement("div");
      buttonContainer.className = "category-title-buttons";
      buttonContainer.style.marginTop = "0.5em";
      heading.parentElement.insertBefore(buttonContainer, heading.nextSibling);
      addButtonToContainer(buttonContainer, category);
      return;
    }
    
    console.log("[Category Files Button] Kein Container gefunden!");
    return;
  }

  addButtonToContainer(header, category);
}

function addButtonToContainer(container, category) {
  // Button erstellen
  const button = document.createElement("button");
  button.className = "btn btn-default category-files-button category-files-button-dynamic";
  button.innerHTML = '<i class="fa fa-file"></i> Dateien';
  button.title = "Dateien";
  button.style.marginLeft = "0.5em";
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openFilesPopup(null, category);
  });

  // Button zum Container hinzufügen
  container.appendChild(button);
  console.log("[Category Files Button] Button hinzugefügt zu:", container.className || container.tagName);
}

function openFilesPopup(apiOrNull, category) {
  // Popup HTML erstellen
  const popupHtml = `
    <div class="category-files-popup-overlay" id="category-files-overlay"></div>
    <div class="category-files-popup" id="category-files-popup">
      <div class="category-files-popup-header">
        <div class="category-files-popup-title">Dateien in Kategorie: ${category.name}</div>
        <button class="category-files-popup-close" id="category-files-close">&times;</button>
      </div>
      <div class="category-files-popup-content" id="category-files-content">
        <div class="category-files-popup-loading">Lade Dateien...</div>
      </div>
    </div>
  `;

  // Popup zum DOM hinzufügen
  document.body.insertAdjacentHTML("beforeend", popupHtml);

  // Event Listener für Schließen
  const overlay = document.getElementById("category-files-overlay");
  const closeBtn = document.getElementById("category-files-close");
  const popup = document.getElementById("category-files-popup");

  const closePopup = () => {
    overlay?.remove();
    popup?.remove();
  };

  overlay?.addEventListener("click", closePopup);
  closeBtn?.addEventListener("click", closePopup);

  // ESC-Taste zum Schließen
  const escHandler = (e) => {
    if (e.key === "Escape") {
      closePopup();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  // Dateien laden
  loadCategoryFiles(category).then(
    (files) => {
      displayFiles(files);
    },
    (error) => {
      displayError(error);
    }
  );
}

async function loadCategoryFiles(category) {
  const filesMap = new Map(); // Map mit URL als Key, um Duplikate zu vermeiden
  const processedTopics = new Set();

  try {
    // Alle Topics der Kategorie abrufen
    const topics = await fetchAllCategoryTopics(category);

    // Für jeden Topic die Posts abrufen und Dateien extrahieren
    for (const topic of topics) {
      if (processedTopics.has(topic.id)) {
        continue;
      }
      processedTopics.add(topic.id);

      try {
        const topicData = await ajax(`/t/${topic.id}.json`);
        if (topicData && topicData.post_stream && topicData.post_stream.posts) {
          topicData.post_stream.posts.forEach((post) => {
            extractFilesFromPost(post, filesMap);
          });
        }
      } catch (error) {
        console.warn(`Fehler beim Laden von Topic ${topic.id}:`, error);
      }
    }

    // Unterkategorien verarbeiten
    if (category.subcategory_list) {
      for (const subcategory of category.subcategory_list) {
        try {
          const subTopics = await fetchAllCategoryTopics(subcategory);
          for (const topic of subTopics) {
            if (processedTopics.has(topic.id)) {
              continue;
            }
            processedTopics.add(topic.id);

            try {
              const topicData = await ajax(`/t/${topic.id}.json`);
              if (topicData && topicData.post_stream && topicData.post_stream.posts) {
                topicData.post_stream.posts.forEach((post) => {
                  extractFilesFromPost(post, filesMap);
                });
              }
            } catch (error) {
              console.warn(`Fehler beim Laden von Topic ${topic.id}:`, error);
            }
          }
        } catch (error) {
          console.warn(`Fehler beim Laden von Unterkategorie ${subcategory.id}:`, error);
        }
      }
    }

    // Konvertiere Map zu Array und sortiere nach Dateinamen
    const filesArray = Array.from(filesMap.values());
    return filesArray.sort((a, b) => a.filename.localeCompare(b.filename));
  } catch (error) {
    console.error("Fehler beim Laden der Kategorie-Dateien:", error);
    throw error;
  }
}

async function fetchAllCategoryTopics(category) {
  const allTopics = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await ajax("/latest.json", {
        data: {
          category: category.id,
          page: page,
        },
      });

      if (response && response.topic_list && response.topic_list.topics) {
        allTopics.push(...response.topic_list.topics);
        hasMore = response.topic_list.more_topics_url;
        page++;
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.warn(`Fehler beim Laden von Seite ${page}:`, error);
      hasMore = false;
    }
  }

  return allTopics;
}

function extractFilesFromPost(post, filesMap) {
  if (!post || !post.cooked) {
    return;
  }

  // Temporäres DOM-Element zum Parsen des HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = post.cooked;

  // Alle Links finden
  const links = tempDiv.querySelectorAll("a[href]");
  links.forEach((link) => {
    const href = link.getAttribute("href");
    if (href && isFileLink(href)) {
      // Normalisiere URL für Vergleich (absolut machen)
      const normalizedUrl = normalizeUrl(href);
      if (!filesMap.has(normalizedUrl)) {
        filesMap.set(normalizedUrl, {
          url: normalizedUrl,
          filename: extractFilename(href, link.textContent),
        });
      }
    }
  });

  // Auch Bilder als Dateien behandeln
  const images = tempDiv.querySelectorAll("img[src]");
  images.forEach((img) => {
    const src = img.getAttribute("src");
    if (src && isFileLink(src)) {
      const normalizedUrl = normalizeUrl(src);
      if (!filesMap.has(normalizedUrl)) {
        filesMap.set(normalizedUrl, {
          url: normalizedUrl,
          filename: extractFilename(src, img.getAttribute("alt") || "Bild"),
        });
      }
    }
  });
}

function normalizeUrl(url) {
  try {
    // Versuche absolute URL zu erstellen
    return new URL(url, window.location.origin).href;
  } catch (e) {
    // Fallback: relative URL beibehalten
    return url;
  }
}

function isFileLink(url) {
  // Prüfen ob es sich um eine Datei handelt
  const fileExtensions = [
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".zip",
    ".rar",
    ".7z",
    ".tar",
    ".gz",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".svg",
    ".bmp",
    ".tiff",
    ".mp4",
    ".avi",
    ".mov",
    ".mp3",
    ".wav",
    ".txt",
    ".csv",
    ".json",
    ".xml",
    ".html",
    ".css",
    ".js",
  ];

  // Discourse Uploads erkennen
  if (url.includes("/uploads/")) {
    return true;
  }

  // Externe Links mit Dateiendungen
  const lowerUrl = url.toLowerCase();
  return fileExtensions.some((ext) => lowerUrl.includes(ext));
}

function extractFilename(url, fallback) {
  // Versuche den Dateinamen aus der URL zu extrahieren
  try {
    const urlObj = new URL(url, window.location.origin);
    const pathname = urlObj.pathname;
    const filename = pathname.split("/").pop();
    
    if (filename && filename.includes(".")) {
      return decodeURIComponent(filename);
    }
    
    // Fallback: Verwende den Link-Text oder einen generischen Namen
    return fallback || "Unbenannte Datei";
  } catch (e) {
    return fallback || "Unbenannte Datei";
  }
}

function displayFiles(files) {
  const content = document.getElementById("category-files-content");
  if (!content) {
    return;
  }

  if (files.length === 0) {
    content.innerHTML = '<div class="category-files-popup-loading">Keine Dateien gefunden.</div>';
    return;
  }

  const filesHtml = `
    <ul class="category-files-list">
      ${files
        .map(
          (file) => {
            const isImage = isImageFile(file.url);
            const imageClass = isImage ? "category-files-image-link" : "";
            return `
        <li class="category-files-list-item">
          <a href="${file.url}" 
             target="_blank" 
             rel="noopener noreferrer"
             class="${imageClass}"
             data-image-url="${isImage ? file.url : ""}"
             data-filename="${escapeHtml(file.filename)}">
            ${escapeHtml(file.filename)}
            ${isImage ? ' <i class="fa fa-image"></i>' : ""}
          </a>
        </li>
      `;
          }
        )
        .join("")}
    </ul>
  `;

  content.innerHTML = filesHtml;

  // Hover-Events für Bilder hinzufügen
  setupImagePreview();
}

function isImageFile(url) {
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".svg", ".bmp", ".webp", ".ico"];
  const lowerUrl = url.toLowerCase();
  
  // Prüfe Dateiendung
  if (imageExtensions.some((ext) => lowerUrl.includes(ext))) {
    return true;
  }
  
  // Prüfe ob es ein Discourse-Upload-Bild ist
  if (url.includes("/uploads/") && (url.includes("optimized") || url.match(/\.(jpg|jpeg|png|gif|svg|webp)/i))) {
    return true;
  }
  
  return false;
}

function setupImagePreview() {
  const imageLinks = document.querySelectorAll(".category-files-image-link");
  
  imageLinks.forEach((link) => {
    const imageUrl = link.getAttribute("data-image-url");
    if (!imageUrl) {
      return;
    }

    let previewElement = null;
    let hideTimeout = null;

    link.addEventListener("mouseenter", (e) => {
      // Verzögere das Anzeigen leicht, um versehentliche Hovers zu vermeiden
      clearTimeout(hideTimeout);
      
      setTimeout(() => {
        if (!previewElement) {
          previewElement = createImagePreview(imageUrl, link);
          document.body.appendChild(previewElement);
        }
        previewElement.style.display = "block";
        positionImagePreview(previewElement, e);
      }, 300);
    });

    link.addEventListener("mousemove", (e) => {
      if (previewElement) {
        positionImagePreview(previewElement, e);
      }
    });

    link.addEventListener("mouseleave", () => {
      if (previewElement) {
        hideTimeout = setTimeout(() => {
          if (previewElement) {
            previewElement.style.display = "none";
          }
        }, 200);
      }
    });
  });
}

function createImagePreview(imageUrl, linkElement) {
  const preview = document.createElement("div");
  preview.className = "category-files-image-preview";
  
  const img = document.createElement("img");
  img.src = imageUrl;
  img.alt = linkElement.getAttribute("data-filename") || "Bildvorschau";
  img.onerror = () => {
    preview.style.display = "none";
  };
  
  preview.appendChild(img);
  return preview;
}

function positionImagePreview(previewElement, event) {
  if (!previewElement) {
    return;
  }

  const mouseX = event.clientX;
  const mouseY = event.clientY;
  const previewWidth = 300;
  const previewHeight = 300;
  const offset = 15;

  let left = mouseX + offset;
  let top = mouseY + offset;

  // Prüfe ob die Vorschau über den rechten Rand hinausgeht
  if (left + previewWidth > window.innerWidth) {
    left = mouseX - previewWidth - offset;
  }

  // Prüfe ob die Vorschau über den unteren Rand hinausgeht
  if (top + previewHeight > window.innerHeight) {
    top = mouseY - previewHeight - offset;
  }

  // Stelle sicher, dass die Vorschau nicht über den oberen Rand hinausgeht
  if (top < 0) {
    top = offset;
  }

  // Stelle sicher, dass die Vorschau nicht über den linken Rand hinausgeht
  if (left < 0) {
    left = offset;
  }

  previewElement.style.left = `${left}px`;
  previewElement.style.top = `${top}px`;
}

function displayError(error) {
  const content = document.getElementById("category-files-content");
  if (!content) {
    return;
  }

  content.innerHTML = `
    <div class="category-files-popup-error">
      Fehler beim Laden der Dateien: ${escapeHtml(error.message || "Unbekannter Fehler")}
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
