#!/bin/bash
# Sends sample webhooks to a running LocalHook instance for demo screenshots

BASE="http://localhost:3000"

# Stripe payment webhook
curl -s -X POST "$BASE/webhooks/stripe" \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1709744400,v1=abc123def456" \
  -H "User-Agent: Stripe/1.0 (+https://stripe.com/docs/webhooks)" \
  -d '{
    "id": "evt_1OqGbR2eZvKYlo2C0RSHFP4h",
    "object": "event",
    "type": "payment_intent.succeeded",
    "data": {
      "object": {
        "id": "pi_3OqGbQ2eZvKYlo2C1nZfGH8k",
        "amount": 14999,
        "currency": "usd",
        "status": "succeeded",
        "customer": "cus_PaB3kxNGLzGHoV",
        "description": "Pro Plan - Annual Subscription",
        "receipt_email": "alex@example.com",
        "payment_method": "pm_1OqGbP2eZvKYlo2CYxBzRnKw",
        "created": 1709744380
      }
    },
    "livemode": true,
    "pending_webhooks": 1,
    "request": {
      "id": "req_a1b2c3d4e5f6",
      "idempotency_key": "key_abc123"
    }
  }' > /dev/null

sleep 0.3

# GitHub push event
curl -s -X POST "$BASE/webhooks/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -H "X-GitHub-Delivery: a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  -H "User-Agent: GitHub-Hookshot/abc1234" \
  -d '{
    "ref": "refs/heads/main",
    "repository": {
      "full_name": "acme/webapp",
      "html_url": "https://github.com/acme/webapp"
    },
    "pusher": {
      "name": "sarah-chen",
      "email": "sarah@acme.dev"
    },
    "head_commit": {
      "id": "f4c5b6a7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3",
      "message": "fix: resolve race condition in webhook handler",
      "timestamp": "2026-03-06T15:42:18-06:00",
      "author": {
        "name": "Sarah Chen",
        "email": "sarah@acme.dev"
      }
    },
    "commits": [
      {
        "id": "f4c5b6a7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3",
        "message": "fix: resolve race condition in webhook handler",
        "added": [],
        "removed": [],
        "modified": ["src/handlers/webhook.ts", "src/lib/queue.ts"]
      }
    ]
  }' > /dev/null

sleep 0.3

# Shopify order webhook
curl -s -X POST "$BASE/webhooks/shopify?shop=acme-store.myshopify.com&topic=orders/create" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: orders/create" \
  -H "X-Shopify-Shop-Domain: acme-store.myshopify.com" \
  -H "X-Shopify-Hmac-Sha256: dGVzdF9obWFjX3ZhbHVl" \
  -H "User-Agent: Shopify-Captain-Hook" \
  -d '{
    "id": 5678901234,
    "order_number": 1042,
    "email": "jamie@example.com",
    "financial_status": "paid",
    "total_price": "89.95",
    "currency": "USD",
    "line_items": [
      {
        "title": "Wireless Bluetooth Headphones",
        "quantity": 1,
        "price": "59.95"
      },
      {
        "title": "USB-C Charging Cable",
        "quantity": 2,
        "price": "15.00"
      }
    ],
    "shipping_address": {
      "city": "Portland",
      "province": "Oregon",
      "country": "US"
    }
  }' > /dev/null

sleep 0.3

# GET health check
curl -s "$BASE/api/health?status=ok&version=2.1.0" \
  -H "User-Agent: HealthChecker/1.0" \
  -H "Accept: application/json" > /dev/null

sleep 0.3

# PUT update user
curl -s -X PUT "$BASE/api/users/usr_28xK9q" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.example" \
  -H "User-Agent: AcmeApp/3.2.1" \
  -d '{
    "name": "Jamie Rodriguez",
    "email": "jamie.r@example.com",
    "role": "admin",
    "preferences": {
      "theme": "dark",
      "notifications": true,
      "timezone": "America/Chicago"
    }
  }' > /dev/null

sleep 0.3

# Slack event
curl -s -X POST "$BASE/integrations/slack/events" \
  -H "Content-Type: application/json" \
  -H "X-Slack-Request-Timestamp: 1709744500" \
  -H "X-Slack-Signature: v0=abc123" \
  -H "User-Agent: Slackbot 1.0 (+https://api.slack.com/robots)" \
  -d '{
    "type": "event_callback",
    "event": {
      "type": "message",
      "channel": "C04QXHG6T",
      "user": "U08JKLM2N",
      "text": "Deploy to production looks good, approving now.",
      "ts": "1709744498.000200"
    },
    "team_id": "T024BE7LD",
    "event_id": "Ev06RQJG4F8P"
  }' > /dev/null

sleep 0.3

# DELETE request
curl -s -X DELETE "$BASE/api/sessions/sess_9fKx2mNpQ" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.example" \
  -H "User-Agent: AcmeApp/3.2.1" > /dev/null

sleep 0.3

# PATCH request
curl -s -X PATCH "$BASE/api/projects/proj_47Yx/settings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.example" \
  -d '{
    "webhook_url": "https://hooks.slack.com/services/T024/B067/abc",
    "retry_policy": "exponential",
    "max_retries": 5
  }' > /dev/null

sleep 0.3

# Twilio SMS webhook
curl -s -X POST "$BASE/webhooks/twilio/sms" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "User-Agent: TwilioProxy/1.1" \
  -d "MessageSid=SM2a3b4c5d6e7f8a9b0c1d2e3f&AccountSid=AC1234567890abcdef&From=%2B15551234567&To=%2B15559876543&Body=Your+order+%231042+has+shipped!" > /dev/null

sleep 0.3

# SendGrid event webhook
curl -s -X POST "$BASE/webhooks/sendgrid/events" \
  -H "Content-Type: application/json" \
  -H "User-Agent: SendGrid Event API" \
  -d '[
    {
      "email": "alex@example.com",
      "event": "delivered",
      "sg_message_id": "14c5d75ce93.dfd.64b469.filter0001",
      "timestamp": 1709744600,
      "smtp-id": "<14c5d75ce93.dfd.64b469@ismtpd-555>",
      "category": ["order-confirmation"]
    },
    {
      "email": "alex@example.com",
      "event": "open",
      "sg_message_id": "14c5d75ce93.dfd.64b469.filter0001",
      "timestamp": 1709744620,
      "useragent": "Mozilla/5.0",
      "ip": "203.0.113.42"
    }
  ]' > /dev/null

echo "Done! Sent 10 sample webhooks to $BASE"
