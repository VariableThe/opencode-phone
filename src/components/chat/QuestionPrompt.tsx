import { useRef, useState } from "react"
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from "react-native"
import { useTranslation } from "react-i18next"
import { defaultPalette, type AppPalette } from "../../lib/opencode-theme"
import { monoFont } from "./tui"

interface QuestionOption {
  label: string
  description: string
}

interface Question {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

interface Props {
  request: {
    id: string
    questions: Question[]
  }
  isDark: boolean
  palette?: AppPalette
  onReply: (answers: string[][]) => void
  onReject: () => void
}

// TUI-style question prompt: flat full-width block, mono text, options as
// flat 1px rows with a `[x]`/`[ ]` text marker (selection never color-only),
// primary-bordered submit. Reply/reject state machine untouched.
export function QuestionPrompt({ request, isDark, palette, onReply, onReject }: Props) {
  const { t } = useTranslation()
  const [answers, setAnswers] = useState<string[][]>(request.questions.map(() => []))
  const [custom, setCustom] = useState("")
  const [showCustom, setShowCustom] = useState(false)
  const [current, setCurrent] = useState(0)
  const c = palette ?? defaultPalette(isDark ? "dark" : "light")
  const mono = monoFont(Platform.OS)

  // A question is answered exactly once. Without this guard, a double-tap on a
  // single-select option schedules two `onReply` timers; the second reply hits
  // an already-resolved request server-side and surfaces a spurious
  // "Reply failed" alert even though the answer went through.
  const replied = useRef(false)
  const reply = (a: string[][]) => {
    if (replied.current) return
    replied.current = true
    onReply(a)
  }
  const reject = () => {
    if (replied.current) return
    replied.current = true
    onReject()
  }

  const q = request.questions[current]
  if (!q) return null

  const toggleOption = (label: string) => {
    setAnswers((prev) => {
      const copy = [...prev]
      const selected = copy[current] || []
      if (q.multiple) {
        copy[current] = selected.includes(label) ? selected.filter((a) => a !== label) : [...selected, label]
      } else {
        copy[current] = [label]
        if (request.questions.length === 1) {
          setTimeout(() => reply(copy), 100)
        }
      }
      return copy
    })
  }

  const submitCustom = () => {
    if (!custom.trim()) return
    const copy = [...answers]
    copy[current] = [custom.trim()]
    setAnswers(copy)
    setCustom("")
    setShowCustom(false)
    if (request.questions.length === 1) {
      reply(copy)
    }
  }

  return (
    <View style={[s.card, { backgroundColor: c.background, borderColor: c.primary }]}>
      <View style={s.header}>
        <Text style={[s.marker, { fontFamily: mono, color: c.primary }]}>?</Text>
        <Text style={[s.title, { fontFamily: mono, color: c.primary }]}>
          {q.header || t("chat.questionPrompt.headerFallback")}
        </Text>
      </View>
      <Text style={[s.question, { fontFamily: mono, color: c.text }]}>{q.question}</Text>

      <View style={s.options}>
        {q.options.map((opt) => {
          const selected = (answers[current] || []).includes(opt.label)
          return (
            <TouchableOpacity
              key={opt.label}
              style={[s.option, { borderColor: selected ? c.primary : c.borderSubtle }]}
              onPress={() => toggleOption(opt.label)}
              accessibilityRole="button"
            >
              <Text style={[s.optionMarker, { fontFamily: mono, color: selected ? c.primary : c.muted }]}>
                {selected ? "[x]" : "[ ]"}
              </Text>
              <View style={s.optionBody}>
                <Text style={[s.optionLabel, { fontFamily: mono, color: selected ? c.primary : c.text }]}>
                  {opt.label}
                </Text>
                {opt.description ? (
                  <Text style={[s.optionDesc, { fontFamily: mono, color: c.muted }]}>{opt.description}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )
        })}

        {q.custom !== false &&
          (showCustom ? (
            <View style={s.customRow}>
              <TextInput
                style={[s.customInput, { fontFamily: mono, color: c.text, borderColor: c.borderSubtle }]}
                placeholder={t("chat.questionPrompt.answerPlaceholder")}
                placeholderTextColor={c.muted}
                value={custom}
                onChangeText={setCustom}
                onSubmitEditing={submitCustom}
                autoFocus
              />
              <TouchableOpacity onPress={submitCustom} style={s.customSubmit} hitSlop={8}>
                <Text style={[s.customSubmitLabel, { fontFamily: mono, color: c.primary }]}>
                  {t("chat.questionPrompt.submit")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={[s.option, { borderColor: c.borderSubtle }]} onPress={() => setShowCustom(true)}>
              <Text style={[s.optionLabel, { fontFamily: mono, color: c.primary }]}>
                {t("chat.questionPrompt.customAnswerLabel")}
              </Text>
            </TouchableOpacity>
          ))}
      </View>

      <View style={s.footer}>
        <TouchableOpacity onPress={reject} hitSlop={8}>
          <Text style={[s.dismiss, { fontFamily: mono, color: c.muted }]}>{t("chat.questionPrompt.dismiss")}</Text>
        </TouchableOpacity>
        {(request.questions.length > 1 || q.multiple) && (
          <TouchableOpacity
            style={[s.submitBtn, { borderColor: c.primary }]}
            onPress={() => {
              if (current < request.questions.length - 1) {
                setCurrent(current + 1)
              } else {
                reply(answers)
              }
            }}
          >
            <Text style={[s.submitText, { fontFamily: mono, color: c.primary }]}>
              {current < request.questions.length - 1 ? t("chat.questionPrompt.next") : t("chat.questionPrompt.submit")}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingLeft: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  marker: { fontSize: 14, fontWeight: "700" },
  title: { fontSize: 13, fontWeight: "700" },
  question: { fontSize: 14, lineHeight: 21, marginBottom: 10 },

  options: { gap: 6 },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    minHeight: 44,
  },
  optionMarker: { fontSize: 13, fontWeight: "700", lineHeight: 20 },
  optionBody: { flex: 1 },
  optionLabel: { fontSize: 14, fontWeight: "600" },
  optionDesc: { fontSize: 12, marginTop: 2, lineHeight: 18 },

  customRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  customInput: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
  },
  customSubmit: { justifyContent: "center", alignItems: "center", padding: 8, minHeight: 44, minWidth: 44 },
  customSubmitLabel: { fontSize: 13, fontWeight: "700" },

  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  dismiss: { fontSize: 13 },
  submitBtn: { paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, minHeight: 44, justifyContent: "center" },
  submitText: { fontWeight: "700", fontSize: 14 },
})
