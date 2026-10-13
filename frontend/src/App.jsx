import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

const FORM_INICIAL = {
  purpose: '',
  term: '',
  home_ownership: '',
  years_in_current_job: '',
  current_loan_amount: '',
  monthly_debt: '',
  years_of_credit_history: '',
  number_of_open_accounts: '',
  number_of_credit_problems: '0',
  bankruptcies: '0',
  credit_score: '',
  annual_income: '',
}

const CAMPOS_TEXTO = ['purpose', 'term', 'home_ownership', 'years_in_current_job']

const ORDEN_ANTIGUEDAD = [
  '< 1 year', '1 year', '2 years', '3 years', '4 years', '5 years',
  '6 years', '7 years', '8 years', '9 years', '10+ years', 'Unknown',
]

const etiqueta = (valor) => {
  if (valor === 'other') return 'Otro (other)'
  if (valor === 'Other') return 'Otro (Other)'
  if (valor === 'Unknown') return 'No informa'
  return valor.replace(/_/g, ' ')
}

function Selector({ nombre, titulo, opciones, valor, onChange }) {
  return (
    <label>
      {titulo}
      <select name={nombre} value={valor} onChange={onChange} required>
        <option value="">Elegí una opción</option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {etiqueta(o)}
          </option>
        ))}
      </select>
    </label>
  )
}

function Numero({ nombre, titulo, valor, onChange, min = '0', max, opcional = false, ayuda }) {
  return (
    <label>
      {titulo}
      {opcional && ' (opcional)'}
      <input
        type="number"
        name={nombre}
        value={valor}
        onChange={onChange}
        min={min}
        max={max}
        step="any"
        required={!opcional}
      />
      {ayuda && <small>{ayuda}</small>}
    </label>
  )
}

export default function App() {
  const [opciones, setOpciones] = useState(null)
  const [form, setForm] = useState(FORM_INICIAL)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    fetch(`${API}/opciones`)
      .then((r) => r.json())
      .then(setOpciones)
      .catch(() => setError('No se pudo conectar con la API. ¿Está corriendo uvicorn?'))
  }, [])

  const manejarCambio = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const enviar = async (e) => {
    e.preventDefault()
    setError('')
    setResultado(null)

    if ((form.credit_score !== '') !== (form.annual_income !== '')) {
      setError('Completá el score y el ingreso juntos, o dejá ambos vacíos.')
      return
    }

    const payload = {}
    for (const [clave, valor] of Object.entries(form)) {
      if (valor === '') continue
      payload[clave] = CAMPOS_TEXTO.includes(clave) ? valor : Number(valor)
    }

    setCargando(true)
    try {
      const resp = await fetch(`${API}/predecir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const datos = await resp.json()
      if (!resp.ok) {
        const detalle = Array.isArray(datos.detail)
          ? datos.detail.map((d) => d.msg).join(' · ')
          : datos.detail
        setError(detalle || 'La API devolvió un error.')
      } else {
        setResultado(datos)
      }
    } catch {
      setError('No se pudo conectar con la API. ¿Está corriendo uvicorn?')
    } finally {
      setCargando(false)
    }
  }

  if (!opciones) {
    return (
      <div className="pagina">
        <p className={error ? 'error' : 'nota'}>{error || 'Cargando opciones… si el servidor estaba inactivo, puede tardar hasta un minuto.'}</p>
      </div>
    )
  }

  const antiguedades = ORDEN_ANTIGUEDAD.filter((o) => opciones['Years in current job'].includes(o))

  return (
    <div className="pagina">
      <header>
        <h1>Motor de scoring de riesgo crediticio</h1>
        <p>Estimá el nivel de riesgo de un préstamo con un modelo entrenado sobre ~90.000 préstamos reales.</p>
      </header>

      <div className="contenido">
        <form onSubmit={enviar}>
          <h2>El préstamo</h2>
          <div className="campos">
            <Selector nombre="purpose" titulo="Propósito" opciones={opciones.Purpose} valor={form.purpose} onChange={manejarCambio} />
            <Selector nombre="term" titulo="Plazo" opciones={opciones.Term} valor={form.term} onChange={manejarCambio} />
            <Numero nombre="current_loan_amount" titulo="Monto del préstamo" valor={form.current_loan_amount} onChange={manejarCambio} min="1" ayuda="Referencia del dataset: ~270.000" />
            <Numero nombre="monthly_debt" titulo="Deuda mensual total" valor={form.monthly_debt} onChange={manejarCambio} ayuda="Pagos mensuales de deuda. Referencia: ~18.000" />
          </div>

          <h2>Perfil del solicitante</h2>
          <div className="campos">
            <Selector nombre="home_ownership" titulo="Vivienda" opciones={opciones['Home Ownership']} valor={form.home_ownership} onChange={manejarCambio} />
            <Selector nombre="years_in_current_job" titulo="Antigüedad en el trabajo" opciones={antiguedades} valor={form.years_in_current_job} onChange={manejarCambio} />
            <Numero nombre="years_of_credit_history" titulo="Años de historial crediticio" valor={form.years_of_credit_history} onChange={manejarCambio} />
            <Numero nombre="number_of_open_accounts" titulo="Cuentas abiertas" valor={form.number_of_open_accounts} onChange={manejarCambio} />
            <Numero nombre="number_of_credit_problems" titulo="Problemas crediticios previos" valor={form.number_of_credit_problems} onChange={manejarCambio} />
            <Numero nombre="bankruptcies" titulo="Quiebras" valor={form.bankruptcies} onChange={manejarCambio} />
          </div>

          <h2>Datos opcionales</h2>
          <div className="campos">
            <Numero nombre="credit_score" titulo="Credit score" valor={form.credit_score} onChange={manejarCambio} min="300" max="850" opcional />
            <Numero nombre="annual_income" titulo="Ingreso anual" valor={form.annual_income} onChange={manejarCambio} min="1" opcional ayuda="Referencia del dataset: ~1.200.000" />
          </div>
          <small>
            Completá los dos o dejá ambos vacíos. Si faltan, se usa un valor promedio y la estimación es menos confiable.
          </small>

          <button type="submit" disabled={cargando}>
            {cargando ? 'Calculando…' : 'Calcular riesgo'}
          </button>
        </form>

        <aside>
          <div>
            {error && <p className="error">{error}</p>}

            {!error && !resultado && (
              <p className="nota">Completá el formulario y calculá para ver el nivel de riesgo.</p>
            )}

            {resultado && (
              <div className={`resultado nivel-${resultado.nivel_riesgo.toLowerCase()}`}>
                <p className="etiqueta">Nivel de riesgo</p>
                <p className="nivel">{resultado.nivel_riesgo}</p>
                <p>
                  En el test, entre los préstamos con este nivel, el{' '}
                  <strong>{resultado.default_historico_pct}%</strong> terminó en default. El promedio de toda la cartera es 25%.
                </p>
                {resultado.aviso && <p className="aviso">{resultado.aviso}</p>}
                {resultado.advertencias?.length > 0 && (
  <div className="aviso">
    <p>Este perfil se sale de lo que el modelo vio al entrenar, así que el resultado es menos confiable:</p>
    <ul>
      {resultado.advertencias.map((a) => <li key={a}>{a}</li>)}
    </ul>
  </div>
)}
              </div>
            )}

            <p className="nota">
              Proyecto de portfolio. El modelo ordena el riesgo de forma modesta (ROC-AUC 0,65): sirve para priorizar,
              no para aprobar o rechazar un préstamo.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}