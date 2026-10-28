/** Yeni etkinliklerde "örnek sorularla başla" seçildiğinde kullanılır. */
export function demoQuestions() {
  return [
    {
      id: 'q_device',
      type: 'mc',
      prompt: 'Bu oturuma hangi cihazdan katılıyorsunuz?',
      options: [
        { id: 'phone', text: 'Telefon' },
        { id: 'computer', text: 'Bilgisayar' },
        { id: 'tablet', text: 'Tablet' },
        { id: 'other', text: 'Diğer' },
      ],
      timeLimit: 0,
    },
    {
      id: 'q_capital',
      type: 'quiz',
      prompt: 'Türkiye Cumhuriyeti’nin başkenti neresidir?',
      options: [
        { id: 'ankara', text: 'Ankara' },
        { id: 'istanbul', text: 'İstanbul' },
        { id: 'izmir', text: 'İzmir' },
        { id: 'bursa', text: 'Bursa' },
      ],
      correctId: 'ankara',
      timeLimit: 20,
      points: 1000,
      note: 'Doğru cevap: Ankara',
    },
    {
      id: 'q_fruit',
      type: 'wordcloud',
      prompt: 'Aklınıza gelen ilk meyveyi yazın',
      options: [],
      timeLimit: 45,
    },
    {
      id: 'q_rating',
      type: 'rating',
      prompt: 'Bu tür canlı oturumları ne kadar faydalı buluyorsunuz?',
      options: [],
      timeLimit: 20,
    },
    {
      id: 'q_open',
      type: 'open',
      prompt: 'Bu araçta görmek istediğiniz bir özellik var mı?',
      options: [],
      timeLimit: 90,
      maxLength: 300,
    },
  ];
}
