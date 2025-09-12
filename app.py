from flask import Flask, request, render_template_string, redirect, url_for, flash
from flask_wtf import FlaskForm
from wtforms import TextAreaField, StringField
from wtforms.validators import DataRequired
import requests
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Ensure secret key is set securely
app.secret_key = os.environ.get("FLASK_SECRET")
if not app.secret_key:
    raise ValueError("FLASK_SECRET environment variable must be set")

# Graph API URL as a constant
GRAPH_API = "https://graph.facebook.com"

# Flask-WTF form for CSRF protection and validation
class TokenForm(FlaskForm):
    user_token = TextAreaField("User Access Token", validators=[DataRequired()])
    app_id = StringField("App ID", validators=[])
    app_secret = StringField("App Secret", validators=[])

HTML = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>FB Page Token Extractor</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
      body { padding-top: 40px; background:#f8f9fa; }
      .card { max-width: 900px; margin: 0 auto; }
      textarea { font-family: monospace; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card shadow-sm">
        <div class="card-body">
          <h3 class="card-title">Facebook Page Token Extractor</h3>
          <p class="text-muted">User access token daalein aur sab page tokens le jaiye.</p>

          {% with messages = get_flashed_messages(with_categories=true) %}
            {% if messages %}
              {% for category, msg in messages %}
                <div class="alert alert-{{category}}">{{ msg }}</div>
              {% endfor %}
            {% endif %}
          {% endwith %}

          <form method="post" action="{{ url_for('extract') }}">
            {{ form.hidden_tag() }}
            <div class="mb-3">
              <label class="form-label">User Access Token</label>
              {{ form.user_token(class="form-control", rows="3", placeholder="Paste user access token here") }}
            </div>

            <div class="mb-3">
              <label class="form-label">(Optional) App ID</label>
              {{ form.app_id(class="form-control", placeholder="If you want to exchange short-lived token (optional)") }}
            </div>

            <div class="mb-3">
              <label class="form-label">(Optional) App Secret</label>
              {{ form.app_secret(class="form-control", placeholder="Required only if you want to get a long-lived user token via exchange") }}
            </div>

            <button class="btn btn-primary">Get Page Tokens</button>
          </form>

          {% if pages %}
            <hr>
            <h5>Found {{ pages|length }} page(s)</h5>
            <div class="table-responsive">
              <table class="table table-sm table-bordered">
                <thead>
                  <tr>
                    <th>Page Name</th>
                    <th>Page ID</th>
                    <th>Page Access Token</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {% for p in pages %}
                    <tr>
                      <td>{{ p.name }}</td>
                      <td>{{ p.id }}</td>
                      <td><textarea class="form-control token-area" rows="2" readonly>{{ p.access_token }}</textarea></td>
                      <td>
                        <button class="btn btn-sm btn-outline-secondary copy-btn">Copy</button>
                      </td>
                    </tr>
                  {% endfor %}
                </tbody>
              </table>
            </div>
            <p class="text-muted small">Note: Page tokens are shown as returned by Facebook. Some tokens may be short- or long-lived depending on how they were issued.</p>
          {% elif pages is defined %}
            <div class="alert alert-warning">Koi page nahi mila — token sahi hai ya permissions missing ho sakti hain (manage_pages/pages_read_engagement/pages_manage_posts etc.).</div>
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
          setTimeout(() => e.target.innerText = 'Copy', 1500);
        }
      });
    </script>
  </body>
</html>
"""

def exchange_short_lived_for_long(user_token, app_id, app_secret):
    """
    Exchange short-lived user token for long-lived token.
    Requires app_id and app_secret.
    Returns token string on success, else original token.
    """
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
        r.raise_for_status()
        data = r.json()
        token = data.get("access_token")
        if token:
            logger.info("Successfully exchanged short-lived token for long-lived token")
            return token
        flash("Token exchange failed, using original token.", "warning")
        return user_token
    except requests.RequestException as e:
        logger.error(f"Token exchange failed: {e}")
        flash(f"Token exchange failed: {e}", "warning")
        return user_token

@app.route("/", methods=["GET"])
def index():
    form = TokenForm()
    return render_template_string(HTML, form=form)

@app.route("/extract", methods=["POST"])
def extract():
    form = TokenForm()
    if not form.validate_on_submit():
        flash("Please provide a valid user access token.", "danger")
        return render_template_string(HTML, form=form)

    user_token = form.user_token.data.strip()
    app_id = form.app_id.data.strip()
    app_secret = form.app_secret.data.strip()

    # Validate app_id format (should be numeric)
    if app_id and not app_id.isdigit():
        flash("App ID must be numeric.", "danger")
        return render_template_string(HTML, form=form)

    # Optionally exchange for long-lived user token
    used_token = exchange_short_lived_for_long(user_token, app_id or None, app_secret or None)

    # Call /me/accounts to list pages and page access tokens
    params = {
        "access_token": used_token,
        "fields": "name,id,access_token"
    }
    try:
        resp = requests.get(f"{GRAPH_API}/me/accounts", params=params, timeout=12)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        logger.error(f"Graph API request failed: {e}")
        flash(f"Network error: {e}", "danger")
        return render_template_string(HTML, form=form)

    if "error" in data:
        err = data["error"]
        msg = err.get("message", str(err))
        logger.error(f"Graph API error: {msg}")
        flash(f"Graph API error: {msg}", "danger")
        return render_template_string(HTML, form=form)

    pages = data.get("data", [])
    # Normalize list of dicts (ensure keys exist)
    norm = [
        {
            "name": p.get("name", "<no name>"),
            "id": p.get("id", ""),
            "access_token": p.get("access_token", "<no token returned>")
        }
        for p in pages
    ]

    return render_template_string(HTML, form=form, pages=norm)

if __name__ == "__main__":
    # Debug mode disabled for production; use a WSGI server like Gunicorn in production
    app.run(host="0.0.0.0", port=5000, debug=False)
