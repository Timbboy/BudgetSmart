document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("searchForm");
  const itemsInput = document.getElementById("items");
  const budgetInput = document.getElementById("budget");
  const resultsDiv = document.getElementById("results");

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const budget = parseFloat(budgetInput.value);
    const items = itemsInput.value.split(",").map(i => i.trim());

    resultsDiv.innerHTML = "<p>Searching...</p>";

    const res = await fetch("/buyer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, budget })
    });
    const data = await res.json();

    if (data.message) {
      resultsDiv.innerHTML = `<p>${data.message}</p>`;
      return;
    }

    const makeSection = (title, arr) => {
      if (!arr || arr.length === 0) return `<h3>${title}</h3><p>No results found</p>`;
      const total = arr.reduce((acc, p) => acc + p.price, 0);
      return `
        <div class="section">
          <h3>${title}</h3>
          <ul>
            ${arr.map(p => `<li>${p.name} - ₦${p.price}</li>`).join("")}
          </ul>
          <p>Total: ₦${total}</p>
        </div>
      `;
    };

    resultsDiv.innerHTML = `
      <div class="results-container">
        ${makeSection("Cheaper Options", data.cheaper)}
        ${makeSection("Within Budget", data.within)}
        ${makeSection("Above Budget", data.above)}
      </div>
    `;
  });
});

