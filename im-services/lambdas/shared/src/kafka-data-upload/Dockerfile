FROM python:3.6
WORKDIR /src
COPY main.py requirements.txt config.json ./
RUN apt-get update && apt-get install make git
RUN apt-get install -y librdkafka-dev
RUN pip install -r requirements.txt
ENTRYPOINT [ "/usr/local/bin/python", "-m", "awslambdaric" ]
CMD ["main.lambda_handler"]
