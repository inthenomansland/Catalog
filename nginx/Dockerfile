FROM nginx:alpine

# Copy frontend files
COPY index.html style.css app.js admin.html admin.js logo-header.svg /usr/share/nginx/html/

# Copy manufacturer logos
COPY logos/ /usr/share/nginx/html/logos/

# Copy nginx config
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
