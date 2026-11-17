import boto3
import base64
import json
import os
import threading
import functools
from confluent_kafka import Producer
from botocore.exceptions import ClientError

## Example body for kafka-data-upload lambda API Gateway
# {
#   "topic": "test",
#   "data": [
#     {
#       "column1": 1,
#       "column2": 1,
#       "column3": 1,
#     },
#     {
#       "column1": 2
#       "column2": 2
#       "column3": 2
#     }
#   ]
# }

def create_producer(config, secret):
    producer_config = {
        'security.protocol': 'SASL_SSL' ,
        'sasl.mechanism': 'PLAIN',
        'sasl.username': secret['saslUsername'],
        'sasl.password': secret['saslPassword'],
        'bootstrap.servers': config['kafkaBootstrapServers']
    }

    producer = Producer(producer_config)

    return producer

def callback(event, error, response):
    # handle response
    event.set()

def wait_for_events(events):
    for event in events:
        event.wait()

def lambda_handler(event, context):
    config = get_config()
    secret = get_secret(config)

    producer = create_producer(config, secret)

    # body can come in two ways depending on if it is from API Gateway or testing
    if 'topic' in event.keys():
        body = event
    else:
        body = json.loads(event['body'])

    # Api must be called with topic and data params
    # Topic is suffix of the full kafka topic (the table name)
    # data is an array of objects which will be uploaded
    topic = config['kafkaTopicNamePrefix'] + body['topic']
    rows = body['data']

    events = []
    rowCounter = 0
    messageResponses = []

    print('Starting message upload')
    for row in rows:
        rowCounter +=1
        message = json.dumps(row)

        # We need to wait for flush to upload the messages in the batch before uploading another
        # To do this, attach threading event which will block the main thread until all messages are confirmed to be sent
        threadEvent = threading.Event()
        callback_with_event = functools.partial(callback, threadEvent)
        producer.produce(topic, message,  on_delivery=callback_with_event)
        events.append(threadEvent)

        # Upload messages in batches of 1000
        if rowCounter == 1000:
            producer.flush()
            wait_for_events(events)
            events = []
            rowCounter = 0
            print('Finished uploading 1000 messages')

    # Upload any remaining messages
    if rowCounter > 0:
        producer.flush()
        wait_for_events(events)
        print('Finished uploading ' + str(rowCounter) + ' messages')

    return {
        "statusCode": 204
    }

def get_config():
    # This file is typically used in node layer so have a long path to get there
    with open('./config.json', 'r') as config_file:
        data = config_file.read()

    # parse file
    obj = json.loads(data)

    # get environment name to get the correct config
    environment = os.environ['NODE_ENV']

    return obj[environment]

def get_secret(config):
    secret_name = config['secret_name']
    region_name = config['region']

    # Create a Secrets Manager client
    session = boto3.session.Session()
    client = session.client(
        service_name='secretsmanager',
        region_name=region_name
    )

    get_secret_value_response = client.get_secret_value(
        SecretId=secret_name
    )

    # Decrypts secret using the associated KMS CMK.
    # Depending on whether the secret is a string or binary, one of these fields will be populated.
    if 'SecretString' in get_secret_value_response:
        secret = get_secret_value_response['SecretString']
    else:
        secret = base64.b64decode(get_secret_value_response['SecretBinary'])

    # get environment name to get the correct secret
    environment = os.environ['NODE_ENV']

    secretValue = json.loads(secret)
    secretValue = secretValue[environment]

    return secretValue
