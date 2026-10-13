import json
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware
import joblib
import pandas as pd
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# --- Cargar el modelo y la metadata una sola vez, al arrancar ---
BASE = Path(__file__).parent
modelo = joblib.load(BASE / "modelo_riesgo.joblib")
modelo.n_jobs = 1
with open(BASE / "metadata.json") as f:
    meta = json.load(f)

app = FastAPI(title="API de Riesgo Crediticio")

ORIGENES = ["http://localhost:5173", "http://127.0.0.1:5173"]
extra = os.getenv("ALLOWED_ORIGINS", "")
ORIGENES += [o.strip() for o in extra.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENES,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# --- Qué datos espera recibir ---
class Prestamo(BaseModel):
    purpose: str
    term: str
    home_ownership: str
    years_in_current_job: str
    current_loan_amount: float = Field(gt=0)
    monthly_debt: float = Field(ge=0)
    years_of_credit_history: float = Field(ge=0)
    number_of_open_accounts: float = Field(ge=0)
    number_of_credit_problems: float = Field(ge=0)
    bankruptcies: float = Field(ge=0)
    credit_score: float | None = Field(default=None, ge=300, le=850)
    annual_income: float | None = Field(default=None, gt=0)


def validar_categorias(p: Prestamo):
    campos = {
        "purpose": "Purpose",
        "term": "Term",
        "home_ownership": "Home Ownership",
        "years_in_current_job": "Years in current job",
    }
    for campo, columna in campos.items():
        valor = getattr(p, campo)
        opciones = meta["categorias"][columna]
        if valor not in opciones:
            raise HTTPException(
                status_code=422,
                detail=f"Valor inválido para {campo}: '{valor}'. Opciones: {opciones}",
            )


def armar_fila(p: Prestamo) -> pd.DataFrame:
    # Si falta score o ingreso, usamos la misma mediana del entrenamiento
    score = p.credit_score if p.credit_score is not None else meta["mediana_credit_score"]
    ingreso = p.annual_income if p.annual_income is not None else meta["mediana_annual_income"]

    fila = {
        "Credit Score": score,
        "Annual Income": ingreso,
        "Years of Credit History": p.years_of_credit_history,
        "Number of Open Accounts": p.number_of_open_accounts,
        "Number of Credit Problems": p.number_of_credit_problems,
        "Bankruptcies": p.bankruptcies,
        "ratio_prestamo_ingreso": round(p.current_loan_amount / ingreso, 3),
        "ratio_deuda_ingreso_mensual": round(p.monthly_debt / (ingreso / 12), 3),
        "datos_imputados": int(
            score == meta["mediana_credit_score"] and ingreso == meta["mediana_annual_income"]
        ),
        "Purpose": p.purpose,
        "Term": p.term,
        "Home Ownership": p.home_ownership,
        "Years in current job": p.years_in_current_job,
    }
    df = pd.DataFrame([fila])
    df = pd.get_dummies(df)
    # Dejar exactamente las 38 columnas que el modelo conoce, en su orden
    return df.reindex(columns=meta["columnas"], fill_value=0)


def nivel_de_riesgo(prob: float) -> str:
    if prob < meta["cortes"]["bajo_max"]:
        return "Bajo"
    elif prob < meta["cortes"]["medio_max"]:
        return "Medio"
    return "Alto"

NOMBRES_CAMPOS = {
    "Credit Score": "Credit score",
    "Annual Income": "Ingreso anual",
    "Years of Credit History": "Años de historial crediticio",
    "Number of Open Accounts": "Cuentas abiertas",
    "ratio_prestamo_ingreso": "Relación préstamo/ingreso",
    "ratio_deuda_ingreso_mensual": "Relación deuda mensual/ingreso mensual",
}


def formato(x: float) -> str:
    return f"{x:.0f}" if abs(x) >= 100 else f"{x:.2f}"


def fuera_de_rango(fila: pd.DataFrame) -> list[str]:
    avisos = []
    for col, r in meta["rangos"].items():
        valor = float(fila[col].iloc[0])
        if valor < r["p1"] or valor > r["p99"]:
            avisos.append(
                f"{NOMBRES_CAMPOS[col]}: {formato(valor)} "
                f"(rango habitual: {formato(r['p1'])} a {formato(r['p99'])})"
            )
    return avisos

@app.get("/opciones")
def opciones():
    return meta["categorias"]


@app.post("/predecir")
def predecir(p: Prestamo):
    if (p.credit_score is None) != (p.annual_income is None):
        raise HTTPException(
            status_code=422,
            detail="Indicá credit_score y annual_income juntos, o dejá ambos vacíos.",
        )

    validar_categorias(p)
    fila = armar_fila(p)
    prob = float(modelo.predict_proba(fila)[0, 1])
    nivel = nivel_de_riesgo(prob)

    faltantes = []
    if p.credit_score is None:
        faltantes.append("credit_score")
    if p.annual_income is None:
        faltantes.append("annual_income")

    return {
        "nivel_riesgo": nivel,
        "default_historico_pct": round(meta["default_historico"][nivel] * 100, 1),
        "probabilidad_modelo": round(prob, 3),
        "campos_estimados": faltantes,
        "aviso": (
            "Se usó un valor promedio para los datos faltantes; la estimación es menos confiable."
            if faltantes else None
        ),
        "advertencias": fuera_de_rango(fila),
    }