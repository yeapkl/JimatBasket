# JimatBasket — static site served by nginx on Cloud Run
# (Google's Docker Hub mirror avoids Docker Hub pull rate limits)
FROM mirror.gcr.io/library/nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/
COPY data/ /usr/share/nginx/html/data/

# Cloud Run sends traffic to $PORT (8080 by default)
EXPOSE 8080
