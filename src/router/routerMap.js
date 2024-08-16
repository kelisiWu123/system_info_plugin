/**
 * 基础路由
 * @type { *[] }
 */

const constantRouterMap = [
    {
        path: '/',
        redirect:{name:'Computer'}

    },
    {
        path: '/computer',
        name: 'Computer',
        component: () => import('@/components/Computer/index.vue'),
    },

]

export default constantRouterMap
