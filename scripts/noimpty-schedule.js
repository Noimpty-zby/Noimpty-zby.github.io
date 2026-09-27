'use strict'

// Sensitive schedules live behind the private API. Also remove stale routes in watch builds.
hexo.extend.filter.register('after_generate', () => {
  hexo.route.remove('schedule/data.json')
})
