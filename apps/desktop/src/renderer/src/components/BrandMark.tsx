import logo from '../assets/logo.jpg'

export default function BrandMark({
  size = 40,
  rounded = 'rounded-2xl',
}: {
  size?: number
  rounded?: string
}) {
  return (
    <img
      src={logo}
      alt="光途Work"
      width={size}
      height={size}
      className={`${rounded} object-cover`}
    />
  )
}
