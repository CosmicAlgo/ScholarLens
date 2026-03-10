---
description: How to deploy ScholarLens to production
---

## Deployment Checklist

1. Verify all tests pass:
```bash
pytest tests/ -v
```

2. Security check — ensure no hardcoded credentials:
```bash
grep -rn "password" src/ --include="*.py"
grep -rn "api_key\|API_KEY" src/ --include="*.py" | grep -v "os.getenv"
```

3. Build production Docker image:
```bash
docker-compose -f docker-compose.yml build
```

4. Push to container registry (when ready):
```bash
docker tag insight-engine your-registry/scholarlens:latest
docker push your-registry/scholarlens:latest
```

5. Deploy to cloud provider (Azure/DigitalOcean — see notes/learning/ for guides)
