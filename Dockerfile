FROM python:3.12.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PAGEVOICE_HOST=0.0.0.0 PAGEVOICE_PORT=8765 PAGEVOICE_DATA=/data
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 pagevoice && useradd --uid 10001 --gid pagevoice --create-home pagevoice \
    && mkdir /data && chown pagevoice:pagevoice /data
WORKDIR /app
COPY requirements-core.lock pyproject.toml ./
RUN python -m pip install --no-cache-dir setuptools==75.8.0 -r requirements-core.lock
COPY pagevoice/ pagevoice/
COPY rag/ rag/
RUN python -m pip install --no-cache-dir --no-deps --no-build-isolation .
USER 10001:10001
VOLUME /data
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD python -c "import urllib.request; urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8765/api/health',headers={'Host':__import__('os').environ.get('PAGEVOICE_ALLOWED_HOSTS','localhost').split(',')[0]}),timeout=3)"
CMD ["pagevoice-server"]
