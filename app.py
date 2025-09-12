from flask import Flask, request, render_template_string, redirect, url_for, flash
import requests, os

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "change_this_in_prod")

HTML = \"\"\"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>FB Page Token Extractor — Detailed</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
      body { padding-top: 40px; background:#f8f9fa; }
      .card { max-width: 1100px; margin: 0 auto; }
      textarea { font-family: monospace; }
      .small-muted { font-size:0.9rem; color:#6c757d; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card shadow-sm">
        <div class="card-body">
          <h3 class="card-title">Facebook Page Token Extractor — Detailed</h3>
          <p class="small-muted">User access token daalein aur page ka name, id, category, fan count aur page token sab milega.</p>

          {% with messages = get_flashed_messages(with_categories=true) %}
            {% if messages %}
              {% for category, msg in messages %}
                <div class="alert alert-{{category}}">{{ msg }}</div>
              {% endfor %}
            {% endif %}
          {% endwith %}

          <form method="post" action="{{ url_for('extract') }}">
            <div class="mb-3">
              <label class="form-label">User Access Token</label>
              <textarea name="user_token" rows="3" class="form-control" placeholder="Paste user access token here" required>{{ request.form.get('user_token','') }}</textarea>
            </div>

            <div class="mb-3 row">
              <div class="col">
                <label class="form-label">(Optional) App ID</label>
                <input type="text" name="app_id" class="form-control" placeholder="If you want to exchange short-lived token (optional)">
              </div>
              <div class="col">
                <label class="form-label">(Optional) App Secret</label>
                <input type="text" name="app_secret" class="form-control" placeholder="Required only if you want to get a long-lived user token via exchange">
              </div>
            </div>

            <button class="btn btn-primary">Get Page Tokens & Details</button>
            <a href="{{ url_for('index') }}" class="btn btn-link">Reset</a>
          </form>

          {% if pages is defined %}
            <hr>
            <h5>Found {{ pages|length }} page(s)</h5>
            {% if pages %}
              <div class="table-responsive">
                <table class="table table-sm table-bordered align-middle">
                  <thead>
                    <tr>
                      <th>Page Name</th>
                      <th>Page ID</th>
                      <th>Category</th>
                      <th>Fan / Followers</th>
                      <th>Permissions</th>
                      <th>Page Access Token</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {% for p in pages %}
                      <tr>
                        <td>{{ p.name }}</td>
                        <td>{{ p.id }}</td>
                        <td>{{ p.category or '-' }}</td>
                        <td>{{ p.fan_count if p.fan_count is not none else '-' }}</td>
                        <td>{{ p.perms | join(', ') if p.perms else '-' }}</td>
                        <td style="min-width:320px;"><textarea class="form-control token-area" rows="2" readonly>{{ p.access_token }}</textarea></td>
                        <td>
                          <button class="btn btn-sm btn-outline-secondary copy-btn">Copy</button>
                        </td>
                      </tr>
                    {% endfor %}
                  </tbody>
                </table>
              </div>
              <p class="text-muted small">Note: Some fields may not be available depending on token permissions. If you see missing data, ensure token includes required scopes.</p>
            {% else %}
              <div class="alert alert-warning">Koi page nahi mila — token sahi hai ya permissions missing ho sakti hain (pages_show_list, pages_read_engagement, pages_read_user_content, pages_manage_metadata etc.).</div>
            {% endif %}
          {% endif %}
        </div>
      </div>
    </div>

    <script>
      document.addEventListener('click', function(e){
        if(e.target && e.target.classList.contains('copy-btn')){
          const row = e.target.closest('tr');
          const ta = row.querySelector('.token-area');
          ta.select();
          document.execCommand('copy');
          e.target.innerText = 'Copied';
          setTimeout(()=> e.target.innerText = 'Copy', 1500);
        }
      });
    </script>
  </body>
</html>
\"\"\"

GRAPH_API = "https://graph.facebook.com"

def exchange_short_lived_for_long(user_token, app_id, app_secret):
    if not (app_id and app_secret):
        return user_token
    params = {
        "grant_type": "fb_exchange_token",
        "client_id": app_id,
        "client_secret": app_secret,
        "fb_exchange_token": user_token
    }
    try:
        r = requests.get(f"{GRAPH_API}/oauth/access_token", params=params, timeout=12)
        data = r.json()
        return data.get("access_token", user_token)
    except Exception:
        return user_token

@app.route("/", methods=["GET"])
def index():
    return render_template_string(HTML)

@app.route("/extract", methods=["POST"])
def extract():
    user_token = request.form.get("user_token","").strip()
    app_id = request.form.get("app_id","").strip()
    app_secret = request.form.get("app_secret","").strip()

    if not user_token:
        flash("Please provide a user access token.", "danger")
        return redirect(url_for("index"))

    used_token = exchange_short_lived_for_long(user_token, app_id or None, app_secret or None)

    # Request more fields for pages: category, fan_count, perms
    params = {
        "access_token": used_token,
        "fields": "name,id,access_token,category,fan_count,perms"
    }
    try:
        resp = requests.get(f"{GRAPH_API}/me/accounts", params=params, timeout=12)
        data = resp.json()
    except Exception as e:
        flash(f"Network error: {e}", "danger")
        return redirect(url_for("index"))

    if "error" in data:
        err = data["error"]
        msg = err.get("message", str(err))
        flash(f"Graph API error: {msg}", "danger")
        return render_template_string(HTML)

    pages = data.get("data", [])
    norm = []
    for p in pages:
        norm.append({
            "name": p.get("name","<no name>"),
            "id": p.get("id",""),
            "category": p.get("category"),
            "fan_count": p.get("fan_count"),
            "perms": p.get("perms", []),
            "access_token": p.get("access_token","<no token returned>")
        })

    return render_template_string(HTML, pages=norm)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
