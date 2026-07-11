Add a new strategy to the local quant assistant.

Requirements:

- Implement as a Backtrader `bt.Strategy`
- Register it in `STRATEGIES`
- Keep parameters visible in Streamlit through `default_params`
- Avoid changing unrelated data adapters or metrics
- From `backend/python-core`, run `python -m compileall app.py src`
